'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useIsMobile } from '@/hooks/use-mobile';
import { db } from '@/lib/firebase';
import { collection, addDoc, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import {
  countCorrectChars,
  calculateWpm,
  countUncorrectedErrors,
  calculateAccuracy,
  updateRunningAverage,
  mergeWithDecay,
} from '@/lib/typing-metrics';
import { playCorrectSound, playErrorSound, playStreakSound } from '@/lib/audio';

const FALLBACK_TEXTS = [
  "The quick brown fox jumps over the lazy dog near the old stone bridge. Every morning, sunlight filters through the tall oak trees and warms the quiet meadow below.",
  "Programming requires patience and careful attention to detail. A single misplaced character can cause an entire application to fail in unexpected and frustrating ways.",
  "Scientists recently discovered a new species of deep sea fish living near volcanic vents. These creatures thrive in extreme heat and total darkness far beneath the ocean surface.",
  "The history of space exploration is filled with remarkable achievements and bold discoveries. From the first satellite launch to the moon landing, humanity has always reached for the stars.",
  "Good writing comes from reading widely and practicing often. The best authors revise their work many times, shaping rough drafts into polished pieces that capture the imagination.",
  "Technology continues to reshape how we communicate, work, and learn. Smartphones and high speed internet have connected billions of people across every continent on Earth.",
  "A balanced breakfast provides the energy needed to start each day with focus and clarity. Fresh fruit, whole grains, and a glass of water make a simple but effective morning routine.",
  "Mountains have inspired artists, poets, and adventurers throughout recorded history. Their towering peaks remind us of the vast scale of nature and the thrill of exploration.",
  "Learning to type quickly and accurately is one of the most valuable skills in the digital age. With practice, your fingers will move across the keyboard with confidence and speed.",
  "The ancient library of Alexandria was once the greatest center of knowledge in the world. Scholars traveled from distant lands to study its vast collection of scrolls and manuscripts.",
];

function generateComboThreshold(): number {
  return Math.floor(Math.random() * 21) + 10;
}

const FOCUS_WINDOW = 15;
const FOCUS_CV_THRESHOLD = 1.2;
const FOCUS_COOLDOWN_MS = 30_000;
const FOCUS_NUDGES = [
  'Take a breath — you\'ve got this.',
  'Slow and steady wins the race.',
  'Try relaxing your shoulders.',
  'Pause if you need to — no rush.',
  'Focus on one key at a time.',
];

interface TypingTestProps {
  weakKeys: Record<string, number>;
  bigrams: Record<string, number>;
  avgWpm: number;
  avgAccuracy: number;
  totalLessons: number;
  topic: string;
  strictMode: boolean;
  audioEnabled: boolean;
  calmMode: boolean;
  totalChunks: number;
  focusKeys: string[];
  onComplete: () => void;
  onCancel: () => void;
}

export default function TypingTest({ weakKeys, bigrams, avgWpm, avgAccuracy, totalLessons, topic, strictMode, audioEnabled, calmMode, totalChunks, focusKeys, onComplete, onCancel }: TypingTestProps) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [startTime, setStartTime] = useState<number | null>(null);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [mistakes, setMistakes] = useState<Record<string, number>>({});
  const [sessionBigrams, setSessionBigrams] = useState<Record<string, number>>({});
  const [totalErrors, setTotalErrors] = useState(0);
  const [saving, setSaving] = useState(false);
  const [errorPops, setErrorPops] = useState<{ id: number; char: string; x: number; y: number }[]>([]);
  const [paused, setPaused] = useState(false);
  const [pausedTime, setPausedTime] = useState(0);
  const [combo, setCombo] = useState(0);
  const [comboFlash, setComboFlash] = useState(false);
  const [bestCombo, setBestCombo] = useState(0);
  const [focusNudge, setFocusNudge] = useState<string | null>(null);
  const [results, setResults] = useState<{ wpm: number; accuracy: number; rawAccuracy: number; duration: number; bestCombo: number } | null>(null);
  const [focusRating, setFocusRating] = useState<number | null>(null);
  const [currentChunk, setCurrentChunk] = useState(1);
  const [chunkTransition, setChunkTransition] = useState(false);
  const chunkStats = useRef({ totalCorrect: 0, totalChars: 0, totalErrors: 0, totalDuration: 0 });

  const inputRef = useRef<HTMLInputElement>(null);
  const hasGenerated = useRef(false);
  const textContainerRef = useRef<HTMLDivElement>(null);
  const charRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const errorPopId = useRef(0);
  const pauseStartRef = useRef(0);
  const nextComboThreshold = useRef(generateComboThreshold());
  const lastKeystrokeTime = useRef(0);
  const recentIntervals = useRef<number[]>([]);
  const lastNudgeTime = useRef(0);

  const shortcutRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const handler = (e: KeyboardEvent) => shortcutRef.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const generateLesson = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/generate-lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weakKeys,
          bigrams,
          avgWpm,
          avgAccuracy,
          totalLessons,
          topic,
          chunkIndex: 0,
          totalChunks: totalChunks,
          focusKeys,
        }),
      });

      if (!response.ok) throw new Error('API request failed');

      const data = await response.json();
      setText(data.text);
      setInput('');
      setStartTime(null);
      setEndTime(null);
      setMistakes({});
      setSessionBigrams({});
      setTotalErrors(0);
      setPaused(false);
      setPausedTime(0);
      setCombo(0);
      setBestCombo(0);
      setComboFlash(false);
      setFocusNudge(null);
      nextComboThreshold.current = generateComboThreshold();
      lastKeystrokeTime.current = 0;
      recentIntervals.current = [];
      lastNudgeTime.current = 0;

      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (error) {
      console.error("Failed to generate lesson:", error);
      setText(FALLBACK_TEXTS[Math.floor(Math.random() * FALLBACK_TEXTS.length)]);
    } finally {
      setLoading(false);
    }
  }, [weakKeys, bigrams, avgWpm, avgAccuracy, totalLessons, topic, totalChunks, focusKeys]);

  useEffect(() => {
    if (!hasGenerated.current) {
      hasGenerated.current = true;
      generateLesson();
    }
  }, [generateLesson]);

  const restartLesson = () => {
    setInput('');
    setStartTime(null);
    setEndTime(null);
    setMistakes({});
    setSessionBigrams({});
    setTotalErrors(0);
    setPaused(false);
    setPausedTime(0);
    setCombo(0);
    setBestCombo(0);
    setComboFlash(false);
    setFocusNudge(null);
    setCurrentChunk(1);
    setChunkTransition(false);
    chunkStats.current = { totalCorrect: 0, totalChars: 0, totalErrors: 0, totalDuration: 0 };
    nextComboThreshold.current = generateComboThreshold();
    lastKeystrokeTime.current = 0;
    recentIntervals.current = [];
    lastNudgeTime.current = 0;
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const togglePause = () => {
    if (paused) {
      setPausedTime(prev => prev + Date.now() - pauseStartRef.current);
      setPaused(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      pauseStartRef.current = Date.now();
      setPaused(true);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const now = Date.now();

    if (!startTime && val.length > 0) {
      setStartTime(now);
    }

    if (val.length > input.length && lastKeystrokeTime.current > 0) {
      const interval = now - lastKeystrokeTime.current;
      if (interval < 5000) {
        recentIntervals.current.push(interval);
        if (recentIntervals.current.length > FOCUS_WINDOW) {
          recentIntervals.current.shift();
        }
        if (recentIntervals.current.length >= FOCUS_WINDOW && now - lastNudgeTime.current > FOCUS_COOLDOWN_MS) {
          const intervals = recentIntervals.current;
          const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
          const variance = intervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / intervals.length;
          const cv = Math.sqrt(variance) / mean;
          if (cv > FOCUS_CV_THRESHOLD) {
            lastNudgeTime.current = now;
            setFocusNudge(FOCUS_NUDGES[Math.floor(Math.random() * FOCUS_NUDGES.length)]);
            setTimeout(() => setFocusNudge(null), 4000);
          }
        }
      }
    }
    lastKeystrokeTime.current = now;

    if (val.length > input.length) {
      const newCharIndex = val.length - 1;
      const expectedChar = text[newCharIndex];
      const typedChar = val[newCharIndex];

      if (expectedChar && typedChar === expectedChar) {
        if (audioEnabled) playCorrectSound();
        setCombo(prev => {
          const next = prev + 1;
          if (next >= nextComboThreshold.current) {
            setComboFlash(true);
            if (audioEnabled) playStreakSound();
            setTimeout(() => setComboFlash(false), 800);
            nextComboThreshold.current = generateComboThreshold();
          }
          setBestCombo(best => Math.max(best, next));
          return next;
        });
      }

      if (expectedChar && typedChar !== expectedChar) {
        setCombo(0);
        if (audioEnabled) playErrorSound();
        setTotalErrors(prev => prev + 1);
        setMistakes(prev => ({
          ...prev,
          [expectedChar.toLowerCase()]: (prev[expectedChar.toLowerCase()] || 0) + 1
        }));
        const bigramKey = `${expectedChar.toLowerCase()}→${typedChar.toLowerCase()}`;
        setSessionBigrams(prev => ({
          ...prev,
          [bigramKey]: (prev[bigramKey] || 0) + 1
        }));

        const charEl = charRefs.current[newCharIndex];
        const containerEl = textContainerRef.current;
        if (!calmMode && charEl && containerEl) {
          const charRect = charEl.getBoundingClientRect();
          const containerRect = containerEl.getBoundingClientRect();
          const id = ++errorPopId.current;
          setErrorPops(prev => [...prev, {
            id,
            char: typedChar,
            x: charRect.left - containerRect.left + charRect.width / 2,
            y: charRect.top - containerRect.top,
          }]);
          setTimeout(() => {
            setErrorPops(prev => prev.filter(p => p.id !== id));
          }, 600);
        }

        if (strictMode) return;
      }
    }

    setInput(val);

    if (val.length === text.length) {
      setEndTime(Date.now());
      finishTest(val);
    }
  };

  const advanceChunk = () => {
    setChunkTransition(true);
    setTimeout(async () => {
      setCurrentChunk(prev => prev + 1);
      setInput('');
      setStartTime(null);
      setEndTime(null);
      setTotalErrors(0);
      setPaused(false);
      setPausedTime(0);
      setCombo(0);
      setComboFlash(false);
      setFocusNudge(null);
      lastKeystrokeTime.current = 0;
      recentIntervals.current = [];
      try {
        const response = await fetch('/api/generate-lesson', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weakKeys, bigrams, avgWpm, avgAccuracy, totalLessons, topic, chunkIndex: currentChunk, totalChunks: totalChunks, focusKeys }),
        });
        if (!response.ok) throw new Error('API request failed');
        const data = await response.json();
        setText(data.text);
      } catch {
        setText(FALLBACK_TEXTS[Math.floor(Math.random() * FALLBACK_TEXTS.length)]);
      }
      setChunkTransition(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }, 1500);
  };

  const finishTest = async (finalInput: string) => {
    if (!user || !startTime) return;

    const durationSeconds = (Date.now() - startTime - pausedTime) / 1000;
    const correctChars = countCorrectChars(text, finalInput);
    const uncorrectedErrors = countUncorrectedErrors(text, finalInput);

    chunkStats.current.totalCorrect += correctChars;
    chunkStats.current.totalChars += text.length;
    chunkStats.current.totalErrors += totalErrors;
    chunkStats.current.totalDuration += durationSeconds;

    if (currentChunk < totalChunks) {
      advanceChunk();
      return;
    }

    setSaving(true);
    const stats = chunkStats.current;
    const wpm = calculateWpm(stats.totalCorrect, stats.totalDuration);
    const rawAccuracy = calculateAccuracy(stats.totalChars, stats.totalErrors);
    const finalUncorrected = stats.totalChars - stats.totalCorrect;
    const accuracy = calculateAccuracy(stats.totalChars, finalUncorrected);

    try {
      await addDoc(collection(db, `users/${user.uid}/lessons`), {
        uid: user.uid,
        createdAt: serverTimestamp(),
        text: `[${totalChunks}-chunk session]`,
        wpm,
        accuracy,
        rawAccuracy,
        duration: Math.round(stats.totalDuration),
        mistakes,
        bigrams: sessionBigrams,
      });

      const userRef = doc(db, 'users', user.uid);
      await runTransaction(db, async (transaction) => {
        const userSnap = await transaction.get(userRef);
        if (!userSnap.exists()) return;

        const userData = userSnap.data();
        const currentTotalLessons = userData.totalLessons || 0;
        const currentAvgWpm = userData.avgWpm || 0;
        const currentAvgAccuracy = userData.avgAccuracy || 0;
        const currentWeakKeys: Record<string, number> = (typeof userData.weakKeys === 'object' && userData.weakKeys) || {};
        const currentBigrams: Record<string, number> = (typeof userData.bigrams === 'object' && userData.bigrams) || {};

        const newWeakKeys = mergeWithDecay(currentWeakKeys, mistakes);
        const newBigrams = mergeWithDecay(currentBigrams, sessionBigrams);

        const newTotalLessons = currentTotalLessons + 1;
        const newAvgWpm = updateRunningAverage(currentAvgWpm, currentTotalLessons, wpm);
        const newAvgAccuracy = updateRunningAverage(currentAvgAccuracy, currentTotalLessons, accuracy);

        transaction.update(userRef, {
          totalLessons: newTotalLessons,
          avgWpm: newAvgWpm,
          avgAccuracy: newAvgAccuracy,
          weakKeys: newWeakKeys,
          bigrams: newBigrams,
        });
      });

      setResults({ wpm, accuracy, rawAccuracy, duration: Math.round(stats.totalDuration), bestCombo });
      setSaving(false);
    } catch (error) {
      console.error("Failed to save lesson:", error);
      setSaving(false);
    }
  };

  const renderText = () => {
    charRefs.current = [];
    return text.split('').map((char, index) => {
      let color = '#b5b0aa';
      let bg = 'transparent';
      let outline = 'none';
      let textDecoration = 'none';

      if (index < input.length) {
        if (input[index] === char) {
          color = '#2a2620';
        } else {
          color = '#7a3f3f';
          bg = 'rgba(122,63,63,0.12)';
          textDecoration = 'underline wavy #7a3f3f';
        }
      } else if (index === input.length) {
        bg = 'rgba(102,95,81,0.15)';
        outline = '1.5px solid #665f51';
      }

      return (
        <span
          key={index}
          ref={el => { charRefs.current[index] = el; }}
          style={{ color, background: bg, outline, textDecoration, borderRadius: 2 }}
          className="transition-colors duration-75"
        >
          {char}
        </span>
      );
    });
  };

  shortcutRef.current = (e: KeyboardEvent) => {
    if (loading || saving || chunkTransition || results) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      if (startTime && !endTime) {
        togglePause();
      }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      inputRef.current?.focus();
      return;
    }

    if (paused) {
      switch (e.key.toLowerCase()) {
        case 'r':
          e.preventDefault();
          restartLesson();
          break;
        case 's':
          e.preventDefault();
          generateLesson();
          break;
        case 'q':
          e.preventDefault();
          onCancel();
          break;
      }
    }
  };

  // ── Chunk transition ───────────────────────────────────────────
  if (chunkTransition) {
    const labels = ['Nice work.', 'Keep it up.', 'Almost there.'];
    return (
      <div className="flex flex-col items-center justify-center py-32 space-y-6">
        <div className="font-serif text-3xl font-bold text-[#665f51]">{labels[currentChunk - 1] || 'Nice work.'}</div>
        <p className="font-serif text-[#7b7771]">Next exercise loading...</p>
        <div className="flex gap-2 mt-4">
          {Array.from({ length: totalChunks }, (_, i) => (
            <div
              key={i}
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: i < currentChunk ? '#665f51' : '#dcd9d7' }}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Results ────────────────────────────────────────────────────
  if (results) {
    const focusLabels = ['Scattered', 'Okay', 'Locked in'];
    return (
      <div className="bg-[#d9d1c0] min-h-[calc(100vh-56px)] py-20 px-6 flex items-start justify-center">
        <div className="bg-[#fcf9f6] border border-[#e5e2df] rounded-[10px] p-10 max-w-[480px] w-full shadow-[0_4px_12px_rgba(40,34,24,0.08)]">
          <div className="font-serif text-[0.7rem] font-medium uppercase tracking-[0.1em] text-[#7b7771] mb-2">
            Practice complete
          </div>
          <h2 className="font-serif text-[2rem] font-bold text-[#2a2620] tracking-[-0.02em] mb-8">Well done.</h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-7">
            {[
              { label: 'WPM', val: results.wpm },
              { label: 'Accuracy', val: `${results.accuracy}%` },
              { label: 'Raw', val: `${results.rawAccuracy}%` },
              { label: 'Best streak', val: results.bestCombo },
            ].map(s => (
              <div key={s.label} className="bg-[#f6f3f1] border border-[#e5e2df] rounded-lg p-4 text-center">
                <div className="font-serif text-[0.65rem] text-[#7b7771] uppercase tracking-[0.08em] mb-1.5">{s.label}</div>
                <div className="font-serif text-[1.6rem] font-bold text-[#665f51] leading-none">{s.val}</div>
              </div>
            ))}
          </div>

          <div className="bg-[#f6f3f1] border border-[#e5e2df] rounded-lg py-4 px-5 mb-6">
            <div className="font-serif text-[0.78rem] font-semibold text-[#2a2620] mb-3">How focused did you feel?</div>
            <div className="flex gap-2">
              {focusLabels.map((label, i) => (
                <button
                  key={label}
                  onClick={() => setFocusRating(i)}
                  className="font-serif text-[0.82rem] flex-1 py-2.5 cursor-pointer transition-all border rounded-md"
                  style={{
                    background: focusRating === i ? '#665f51' : '#fcf9f6',
                    color: focusRating === i ? '#fff' : '#665f51',
                    borderColor: focusRating === i ? '#665f51' : '#dcd9d7',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2.5">
            <button
              onClick={() => { setResults(null); setFocusRating(null); restartLesson(); }}
              className="font-serif text-[0.9rem] font-semibold flex-1 py-2.5 bg-[#665f51] hover:bg-[#3d3830] text-white border-none rounded-md cursor-pointer transition-colors"
            >
              Practice again
            </button>
            <button
              onClick={onComplete}
              className="font-serif text-[0.9rem] flex-1 py-2.5 bg-[#f1edea] hover:bg-[#e5e2df] text-[#665f51] border border-[#dcd9d7] rounded-md cursor-pointer transition-colors"
            >
              Back to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Mobile fallback ────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="flex flex-col items-center justify-center py-32 space-y-6 text-center px-6">
        <h2 className="font-serif text-2xl font-bold text-[#2a2620]">Physical keyboard required</h2>
        <p className="font-serif text-[#7b7771] max-w-md leading-relaxed">
          Typing tests work best with a physical keyboard. Please switch to a desktop or laptop computer for the best experience.
        </p>
        <button
          onClick={onCancel}
          className="font-serif text-[0.9rem] text-[#665f51] bg-[#f1edea] border border-[#dcd9d7] rounded-md px-5 py-2 cursor-pointer hover:bg-[#e5e2df] transition-colors"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 space-y-6">
        <div className="h-10 w-10 rounded-full border-2 border-[#665f51] border-t-transparent animate-spin" />
        <p className="font-serif text-lg text-[#665f51]">Generating your personalized lesson...</p>
      </div>
    );
  }

  // ── Active session ─────────────────────────────────────────────
  const progress = Math.round((input.length / text.length) * 100) || 0;
  const uncorrectedCount = input.split('').filter((ch, i) => i < text.length && ch !== text[i]).length;
  const elapsedSeconds = startTime ? (Date.now() - startTime - pausedTime) / 1000 : 0;
  const currentWpm = elapsedSeconds > 1 && input.length > 0
    ? Math.round((countCorrectChars(text, input) / 5) / (elapsedSeconds / 60))
    : 0;
  const currentAccuracy = input.length > 0
    ? Math.round(((input.length - totalErrors) / Math.max(input.length, 1)) * 100)
    : 100;

  return (
    <div className="bg-[#d9d1c0] min-h-[calc(100vh-56px)] pt-9 pb-20">
      <div className="max-w-[680px] mx-auto px-6">

        {/* Header */}
        <div className="mb-5">
          <button
            onClick={onCancel}
            className="font-serif text-[0.82rem] text-[#7b7771] bg-transparent border-none cursor-pointer p-0 mb-2 block hover:text-[#2a2620] transition-colors"
          >
            ← Dashboard
          </button>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-serif text-[1.6rem] font-bold text-[#2a2620] tracking-[-0.02em]">AI typing lesson</h2>
            <div className="flex gap-1.5">
              {Array.from({ length: totalChunks }, (_, i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: i < currentChunk - 1 ? '#665f51' : i === currentChunk - 1 ? '#665f51' : '#dcd9d7',
                  }}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <div className="font-serif text-[0.8rem] text-[#7b7771]">
              Block {currentChunk} of {totalChunks}
              {topic && topic !== 'general' && <> · {topic.startsWith('custom:') ? topic.slice(7) || 'custom' : topic}</>}
            </div>
            <button
              onClick={restartLesson}
              disabled={saving || paused}
              className="font-serif text-[0.75rem] text-[#665f51] bg-transparent border border-[#c9c5c1] rounded px-2 py-0.5 cursor-pointer hover:bg-[#f1edea] transition-colors disabled:opacity-50"
            >
              Restart
            </button>
            <button
              onClick={generateLesson}
              disabled={saving || paused}
              className="font-serif text-[0.75rem] text-[#665f51] bg-transparent border border-[#c9c5c1] rounded px-2 py-0.5 cursor-pointer hover:bg-[#f1edea] transition-colors disabled:opacity-50"
            >
              Skip
            </button>
            {startTime && !endTime && (
              <button
                onClick={togglePause}
                disabled={saving}
                className="font-serif text-[0.75rem] text-[#665f51] bg-transparent border border-[#c9c5c1] rounded px-2 py-0.5 cursor-pointer hover:bg-[#f1edea] transition-colors disabled:opacity-50"
                title="Esc"
              >
                {paused ? 'Resume' : 'Pause'}
              </button>
            )}
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-2.5 mb-3.5 flex-wrap">
          <StatPill label="wpm" value={currentWpm || '—'} muted={currentWpm === 0} />
          <StatPill label="accuracy" value={`${currentAccuracy}%`} />
          <StatPill label="errors" value={totalErrors} muted={totalErrors === 0} />
          <StatPill label="uncorrected" value={uncorrectedCount} muted={uncorrectedCount === 0} />
          {!calmMode && (
            <StatPill
              label="combo"
              value={combo > 0 ? combo : '—'}
              muted={combo === 0}
              flash={comboFlash}
            />
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <div className="w-[110px] h-[5px] bg-[#dcd9d7] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#665f51] rounded-full transition-[width] duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="font-mono text-[0.7rem] text-[#7b7771]">{progress}%</span>
          </div>
        </div>

        {/* AI nudge / hint */}
        {focusNudge ? (
          <div className="font-serif text-[0.85rem] text-[#2a2620] bg-[#fcf9f6] border border-[#e5e2df] border-l-[3px] border-l-[#7a6030] rounded-md py-3 px-4 mb-4 leading-[1.55] shadow-[0_1px_2px_rgba(40,34,24,0.04)]">
            <span className="font-bold text-[#7a6030] mr-2 text-[0.68rem] tracking-[0.1em] uppercase">Focus</span>
            {focusNudge}
          </div>
        ) : (
          <div className="font-serif text-[0.85rem] text-[#2a2620] bg-[#fcf9f6] border border-[#e5e2df] border-l-[3px] border-l-[#665f51] rounded-md py-3 px-4 mb-4 leading-[1.55] shadow-[0_1px_2px_rgba(40,34,24,0.04)]">
            <span className="font-bold text-[#665f51] mr-2 text-[0.68rem] tracking-[0.1em] uppercase">Tip</span>
            Focus on accuracy over speed — your fingers will catch up.
          </div>
        )}

        {/* Text display */}
        <div
          ref={textContainerRef}
          role="region"
          aria-label="Typing test area. Click to focus and start typing."
          className={`bg-[#fcf9f6] border border-[#dcd9d7] rounded-lg ${calmMode ? 'shadow-none px-7 py-7' : 'shadow-[0_2px_6px_rgba(40,34,24,0.07)] px-8 py-7'} mb-2.5 relative cursor-text ${paused ? 'select-none' : ''}`}
          onClick={() => inputRef.current?.focus()}
        >
          <div
            className={`font-mono ${calmMode ? 'text-[1rem] leading-[1.95]' : 'text-[1.05rem] leading-[2.1]'} tracking-[0.02em] break-words ${paused ? 'blur-md' : ''} transition-all duration-200`}
          >
            {renderText()}
          </div>

          {errorPops.map(pop => (
            <span
              key={pop.id}
              className="absolute pointer-events-none font-bold animate-error-pop"
              style={{ left: pop.x, top: pop.y, transform: 'translateX(-50%)', color: '#7a3f3f' }}
            >
              {pop.char}
            </span>
          ))}

          <input
            ref={inputRef}
            type="text"
            aria-label="Type the displayed text here"
            aria-live="off"
            className="absolute opacity-0 pointer-events-none"
            value={input}
            onChange={handleInputChange}
            disabled={saving || !!endTime || paused}
            autoFocus
          />

          {comboFlash && !calmMode && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 px-3.5 py-1 rounded-full bg-[#f6f3f1] border border-[#7a6030] text-[#7a6030] text-xs font-semibold shadow-sm">
              Streak.
            </div>
          )}

          {saving && (
            <div className="absolute inset-0 bg-[#fcf9f6]/90 backdrop-blur-sm rounded-lg flex flex-col items-center justify-center">
              <div className="h-8 w-8 rounded-full border-2 border-[#665f51] border-t-transparent animate-spin mb-3" />
              <p className="font-serif font-medium text-[#665f51]">Saving your progress...</p>
            </div>
          )}

          {paused && (
            <div
              className="absolute inset-0 bg-[#fcf9f6]/93 backdrop-blur-sm rounded-lg flex flex-col items-center justify-center cursor-pointer"
              onClick={togglePause}
            >
              <p className="font-serif text-xl font-semibold text-[#2a2620]">Paused</p>
              <p className="font-serif text-sm text-[#7b7771] mt-2">
                Click or press <kbd className="px-1.5 py-0.5 rounded bg-[#f1edea] text-[#665f51] font-mono text-xs border border-[#dcd9d7]">Esc</kbd> to resume
              </p>
              <div className="flex gap-4 mt-4 text-xs text-[#7b7771]">
                <span><kbd className="px-1.5 py-0.5 rounded bg-[#f1edea] text-[#665f51] font-mono border border-[#dcd9d7]">R</kbd> restart</span>
                <span><kbd className="px-1.5 py-0.5 rounded bg-[#f1edea] text-[#665f51] font-mono border border-[#dcd9d7]">S</kbd> skip</span>
                <span><kbd className="px-1.5 py-0.5 rounded bg-[#f1edea] text-[#665f51] font-mono border border-[#dcd9d7]">Q</kbd> cancel</span>
              </div>
            </div>
          )}
        </div>

        <div className="font-serif text-[0.72rem] text-[#7b7771] text-center mb-4">
          Click anywhere and begin typing. Backspace to correct errors.
        </div>

        {/* Home row reference */}
        <div className="flex gap-1.5 justify-center flex-wrap mb-2">
          {['A','S','D','F','G','H','J','K','L',';'].map(k => (
            <span
              key={k}
              className="inline-flex items-center justify-center font-mono text-[0.72rem] bg-[#fcf9f6] text-[#665f51] rounded-[5px] min-w-[30px] h-[30px] px-1.5 border border-[#c9c5c1]"
              style={{ borderBottom: '3px solid #b5b0aa' }}
            >
              {k}
            </span>
          ))}
        </div>

        {/* Keyboard shortcuts hint */}
        <div className="flex justify-center gap-4 text-[0.7rem] text-[#7b7771] mt-4">
          <span><kbd className="px-1 py-0.5 rounded bg-[#f1edea] text-[#665f51] font-mono border border-[#dcd9d7]">Tab</kbd> focus</span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-[#f1edea] text-[#665f51] font-mono border border-[#dcd9d7]">Esc</kbd> pause
          </span>
        </div>
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  muted,
  flash,
}: {
  label: string;
  value: string | number;
  muted?: boolean;
  flash?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center bg-[#fcf9f6] border rounded-md py-2 px-4 min-w-[60px] shadow-[0_1px_2px_rgba(40,34,24,0.05)] transition-all"
      style={{
        borderColor: flash ? '#7a6030' : '#e5e2df',
        background: flash ? '#f6f3f1' : '#fcf9f6',
      }}
    >
      <span
        className="font-serif text-[1.15rem] font-bold leading-none"
        style={{ color: flash ? '#7a6030' : muted ? '#c9c5c1' : '#665f51' }}
      >
        {value}
      </span>
      <span className="font-serif text-[0.63rem] text-[#7b7771] mt-1 tracking-[0.05em]">{label}</span>
    </div>
  );
}
