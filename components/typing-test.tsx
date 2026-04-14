'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Keyboard, Loader2, Pause, Play, RefreshCw, RotateCcw, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useIsMobile } from '@/hooks/use-mobile';
import { db } from '@/lib/firebase';
import { collection, addDoc, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import {
  applyDecay,
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

// Variable-ratio reinforcement: reward at unpredictable intervals (10-30 range)
function generateComboThreshold(): number {
  return Math.floor(Math.random() * 21) + 10;
}

// Focus decay: if rolling CV of keystroke intervals exceeds this, nudge
const FOCUS_WINDOW = 15; // last N keystrokes
const FOCUS_CV_THRESHOLD = 1.2; // coefficient of variation threshold
const FOCUS_COOLDOWN_MS = 30_000; // don't nudge more than once per 30s
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
  // Session chunking: break lesson into multiple short blocks
  const [currentChunk, setCurrentChunk] = useState(1);
  const [chunkTransition, setChunkTransition] = useState(false);
  // Accumulate stats across chunks
  const chunkStats = useRef({ totalCorrect: 0, totalChars: 0, totalErrors: 0, totalDuration: 0 });

  const inputRef = useRef<HTMLInputElement>(null);
  const hasGenerated = useRef(false);
  const textContainerRef = useRef<HTMLDivElement>(null);
  const charRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const errorPopId = useRef(0);
  const pauseStartRef = useRef(0);
  // Variable-ratio thresholds for combo rewards (unpredictable intervals)
  const nextComboThreshold = useRef(generateComboThreshold());
  // Focus decay: track recent inter-keystroke intervals
  const lastKeystrokeTime = useRef(0);
  const recentIntervals = useRef<number[]>([]);
  const lastNudgeTime = useRef(0);

  // Keyboard shortcuts — use a ref so the listener registers once but always sees current state
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
  }, [weakKeys, bigrams, avgWpm, avgAccuracy, totalLessons, topic]);

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

    // Focus decay detection: track inter-keystroke timing
    if (val.length > input.length && lastKeystrokeTime.current > 0) {
      const interval = now - lastKeystrokeTime.current;
      // Ignore very long pauses (>5s) — likely deliberate pause, not drift
      if (interval < 5000) {
        recentIntervals.current.push(interval);
        if (recentIntervals.current.length > FOCUS_WINDOW) {
          recentIntervals.current.shift();
        }
        // Check variance when we have enough data
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

    // Check for mistakes on the newly typed character
    if (val.length > input.length) {
      const newCharIndex = val.length - 1;
      const expectedChar = text[newCharIndex];
      const typedChar = val[newCharIndex];

      if (expectedChar && typedChar === expectedChar) {
        // Correct keystroke — build combo
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
        // Track bigram: "expected→typed"
        const bigramKey = `${expectedChar.toLowerCase()}→${typedChar.toLowerCase()}`;
        setSessionBigrams(prev => ({
          ...prev,
          [bigramKey]: (prev[bigramKey] || 0) + 1
        }));

        // Spawn floating error pop (suppressed in calm mode)
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

        // In strict mode, don't advance past the error
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
    // Show transition screen, then generate next chunk — keep it visible until text is ready
    setChunkTransition(true);
    setTimeout(async () => {
      setCurrentChunk(prev => prev + 1);
      // Reset per-chunk state but keep accumulated mistakes/bigrams
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
      // Generate new text for the next chunk (currentChunk closure value = previous chunk's 1-based index, works as 0-based index for the next chunk)
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
      // Hide transition screen only after new text is ready to prevent old text flash
      setChunkTransition(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }, 1500);
  };

  const finishTest = async (finalInput: string) => {
    if (!user || !startTime) return;

    const durationSeconds = (Date.now() - startTime - pausedTime) / 1000;
    const correctChars = countCorrectChars(text, finalInput);
    const uncorrectedErrors = countUncorrectedErrors(text, finalInput);

    // Accumulate stats across chunks
    chunkStats.current.totalCorrect += correctChars;
    chunkStats.current.totalChars += text.length;
    chunkStats.current.totalErrors += totalErrors;
    chunkStats.current.totalDuration += durationSeconds;

    // If more chunks remain, advance to next
    if (currentChunk < totalChunks) {
      advanceChunk();
      return;
    }

    // Final chunk — compute aggregate stats and save
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

  // Find the end of the current sentence (for progressive reveal)
  const getRevealBoundary = useCallback((pos: number): number => {
    // Reveal up to the end of the current sentence from cursor position
    const sentenceEnds = /[.!?]/g;
    let match;
    let boundary = text.length;
    sentenceEnds.lastIndex = pos;
    // Find the next sentence-ending punctuation after cursor
    while ((match = sentenceEnds.exec(text)) !== null) {
      // Include trailing space after punctuation
      boundary = Math.min(text.length, match.index + 2);
      break;
    }
    return boundary;
  }, [text]);

  const renderText = () => {
    charRefs.current = [];
    const revealEnd = getRevealBoundary(input.length);

    return text.split('').map((char, index) => {
      let color = 'text-zinc-500';
      const isBeyondReveal = index >= revealEnd;

      if (index < input.length) {
        if (input[index] === char) {
          color = 'text-zinc-50';
        } else {
          color = 'text-red-500 bg-red-500/20 underline decoration-red-500 decoration-wavy';
        }
      } else if (index === input.length) {
        color = 'text-zinc-500 bg-zinc-800 animate-pulse';
      } else if (isBeyondReveal) {
        color = 'text-zinc-800';
      }

      return (
        <span
          key={index}
          ref={el => { charRefs.current[index] = el; }}
          className={`transition-colors duration-75 ${color}`}
        >
          {char}
        </span>
      );
    });
  };

  // Assign current shortcut handler (always sees latest state/closures)
  shortcutRef.current = (e: KeyboardEvent) => {
    // Inactive during loading, saving, transitions, or results
    if (loading || saving || chunkTransition || results) return;

    // Escape — toggle pause (only once typing has started)
    if (e.key === 'Escape') {
      e.preventDefault();
      if (startTime && !endTime) {
        togglePause();
      }
      return;
    }

    // Tab — re-focus the typing input
    if (e.key === 'Tab') {
      e.preventDefault();
      inputRef.current?.focus();
      return;
    }

    // While paused, single-key shortcuts (input is disabled so these won't type)
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

  if (chunkTransition) {
    const labels = ['Nice work!', 'Keep it up!', 'Almost there!'];
    return (
      <div className="flex flex-col items-center justify-center py-32 space-y-6 animate-in fade-in duration-300">
        <div className="text-4xl font-bold text-emerald-400">{labels[currentChunk - 1] || 'Nice work!'}</div>
        <p className="text-zinc-400">Next exercise loading...</p>
        <div className="flex gap-2 mt-4">
          {Array.from({ length: totalChunks }, (_, i) => (
            <div key={i} className={`w-3 h-3 rounded-full ${i < currentChunk ? 'bg-emerald-500' : 'bg-zinc-700'}`} />
          ))}
        </div>
      </div>
    );
  }

  if (results) {
    const focusLabels = ['Scattered', 'Okay', 'Locked In'];
    return (
      <div className="max-w-2xl mx-auto py-16 animate-in fade-in zoom-in-95 duration-300">
        <h2 className="text-3xl font-bold tracking-tight text-center mb-10">Lesson Complete</h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 text-center">
            <div className="text-sm text-zinc-400 mb-1">WPM</div>
            <div className="text-3xl font-bold">{results.wpm}</div>
          </div>
          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 text-center">
            <div className="text-sm text-zinc-400 mb-1">Accuracy</div>
            <div className="text-3xl font-bold">{results.accuracy}%</div>
          </div>
          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 text-center">
            <div className="text-sm text-zinc-400 mb-1">Raw Accuracy</div>
            <div className="text-3xl font-bold text-zinc-500">{results.rawAccuracy}%</div>
          </div>
          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 text-center">
            <div className="text-sm text-zinc-400 mb-1">Best Streak</div>
            <div className="text-3xl font-bold text-yellow-400">{results.bestCombo}</div>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 mb-8">
          <h3 className="text-lg font-semibold text-center mb-4">How focused did you feel?</h3>
          <div className="flex justify-center gap-4">
            {[1, 2, 3].map(rating => (
              <button
                key={rating}
                onClick={() => setFocusRating(rating)}
                className={`flex flex-col items-center gap-2 px-6 py-4 rounded-xl transition-all ${
                  focusRating === rating
                    ? 'bg-emerald-600 text-white scale-105'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                <span className="text-2xl">{['🌊', '👍', '🎯'][rating - 1]}</span>
                <span className="text-sm font-medium">{focusLabels[rating - 1]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-center">
          <Button
            onClick={onComplete}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-8"
          >
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="flex flex-col items-center justify-center py-32 space-y-6 text-center px-6">
        <Keyboard className="h-12 w-12 text-zinc-500" />
        <h2 className="text-2xl font-bold">Physical Keyboard Required</h2>
        <p className="text-zinc-400 max-w-md">
          Typing tests work best with a physical keyboard. Please switch to a desktop or laptop computer for the best experience.
        </p>
        <Button variant="outline" onClick={onCancel} className="text-zinc-400">
          Back to Dashboard
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 space-y-6">
        <Loader2 className="h-12 w-12 animate-spin text-emerald-500" />
        <p className="text-xl text-zinc-400 animate-pulse">Generating your personalized lesson...</p>
      </div>
    );
  }

  return (
    <div className={`max-w-4xl mx-auto py-12 ${calmMode ? '' : 'animate-in fade-in zoom-in-95 duration-300'}`}>
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold tracking-tight">AI Typing Lesson</h2>
          <div className="flex gap-1.5">
            {Array.from({ length: totalChunks }, (_, i) => (
              <div key={i} className={`w-2 h-2 rounded-full ${i < currentChunk ? 'bg-emerald-500' : i === currentChunk - 1 ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-700'}`} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={restartLesson} disabled={saving || paused} className="text-zinc-400">
            <RotateCcw className="h-4 w-4 mr-2" />
            Restart
          </Button>
          <Button variant="outline" size="sm" onClick={generateLesson} disabled={saving || paused} className="text-zinc-400">
            <RefreshCw className="h-4 w-4 mr-2" />
            Skip
          </Button>
          {startTime && !endTime && (
            <Button variant="outline" size="sm" onClick={togglePause} disabled={saving} className="text-zinc-400" title="Esc">
              {paused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
              {paused ? 'Resume' : 'Pause'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving} className="text-zinc-400 hover:text-white">
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
        </div>
      </div>

      <div
        ref={textContainerRef}
        role="region"
        aria-label="Typing test area. Click to focus and start typing."
        className={`relative p-8 rounded-2xl border font-mono tracking-tight cursor-text ${paused ? 'select-none' : ''} ${calmMode ? 'bg-zinc-950 border-zinc-900 text-xl md:text-2xl leading-loose shadow-none' : 'bg-zinc-900 border-zinc-800 text-2xl md:text-3xl leading-relaxed shadow-xl'}`}
        onClick={() => inputRef.current?.focus()}
      >
        <span className={paused ? 'blur-md transition-all duration-200' : 'transition-all duration-200'}>{renderText()}</span>

        {errorPops.map(pop => (
          <span
            key={pop.id}
            className="absolute pointer-events-none text-red-500 font-bold animate-error-pop"
            style={{ left: pop.x, top: pop.y, transform: 'translateX(-50%)' }}
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

        {focusNudge && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-emerald-900/80 text-emerald-300 text-sm font-medium backdrop-blur-sm animate-in fade-in zoom-in-95 duration-300">
            {focusNudge}
          </div>
        )}

        {saving && (
          <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500 mb-4" />
            <p className="font-medium text-zinc-300">Saving your progress...</p>
          </div>
        )}

        {paused && (
          <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center cursor-pointer" onClick={togglePause}>
            <Play className="h-12 w-12 text-emerald-500 mb-4" />
            <p className="font-medium text-zinc-300">Paused</p>
            <p className="text-sm text-zinc-500 mt-2">Click or press <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono text-xs">Esc</kbd> to resume</p>
            <div className="flex gap-4 mt-4 text-xs text-zinc-600">
              <span><kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">R</kbd> restart</span>
              <span><kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">S</kbd> skip</span>
              <span><kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">Q</kbd> cancel</span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between text-zinc-400" role="status" aria-live="polite" aria-label="Typing statistics">
        <div className="flex gap-8">
          <div>
            <div className="text-sm uppercase tracking-wider font-semibold mb-1">Progress</div>
            <div className="text-xl font-mono text-zinc-50" aria-label={`Progress: ${Math.round((input.length / text.length) * 100) || 0} percent`}>{Math.round((input.length / text.length) * 100) || 0}%</div>
          </div>
          {!calmMode && (
            <div>
              <div className="text-sm uppercase tracking-wider font-semibold mb-1">Combo</div>
              <div className={`text-xl font-mono transition-all duration-200 ${comboFlash ? 'text-yellow-400 scale-125' : combo > 0 ? 'text-emerald-400' : 'text-zinc-500'}`}>
                {combo > 0 ? combo : '-'}
                {bestCombo > 10 && <span className="text-xs text-zinc-500 ml-1">best {bestCombo}</span>}
              </div>
            </div>
          )}
          <div>
            <div className="text-sm uppercase tracking-wider font-semibold mb-1">Errors</div>
            <div className="text-xl font-mono text-red-400" aria-label={`Total errors: ${totalErrors}`}>{totalErrors}</div>
          </div>
          <div>
            <div className="text-sm uppercase tracking-wider font-semibold mb-1">Uncorrected</div>
            <div className="text-xl font-mono text-red-400">
              {input.split('').filter((ch, i) => i < text.length && ch !== text[i]).length}
            </div>
          </div>
        </div>

        {comboFlash && !calmMode && (
          <div className="text-yellow-400 font-bold text-sm animate-bounce">
            Streak!
          </div>
        )}
        {(!comboFlash || calmMode) && (
          <div className="text-sm">
            Focus on accuracy over speed.
          </div>
        )}
      </div>

      <div className="mt-3 flex justify-center gap-4 text-xs text-zinc-600">
        <span><kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono">Tab</kbd> focus</span>
        <span><kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono">Esc</kbd> pause, then <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono">R</kbd> <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono">S</kbd> <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono">Q</kbd></span>
      </div>
    </div>
  );
}
