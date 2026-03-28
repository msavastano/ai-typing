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

interface TypingTestProps {
  weakKeys: Record<string, number>;
  bigrams: Record<string, number>;
  avgWpm: number;
  avgAccuracy: number;
  totalLessons: number;
  topic: string;
  strictMode: boolean;
  onComplete: () => void;
  onCancel: () => void;
}

export default function TypingTest({ weakKeys, bigrams, avgWpm, avgAccuracy, totalLessons, topic, strictMode, onComplete, onCancel }: TypingTestProps) {
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

  const inputRef = useRef<HTMLInputElement>(null);
  const hasGenerated = useRef(false);
  const textContainerRef = useRef<HTMLDivElement>(null);
  const charRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const errorPopId = useRef(0);
  const pauseStartRef = useRef(0);

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

    if (!startTime && val.length > 0) {
      setStartTime(Date.now());
    }

    // Check for mistakes on the newly typed character
    if (val.length > input.length) {
      const newCharIndex = val.length - 1;
      const expectedChar = text[newCharIndex];
      const typedChar = val[newCharIndex];

      if (expectedChar && typedChar !== expectedChar) {
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

        // Spawn floating error pop
        const charEl = charRefs.current[newCharIndex];
        const containerEl = textContainerRef.current;
        if (charEl && containerEl) {
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

  const finishTest = async (finalInput: string) => {
    if (!user || !startTime) return;
    setSaving(true);

    const durationSeconds = (Date.now() - startTime - pausedTime) / 1000;
    const correctChars = countCorrectChars(text, finalInput);
    const wpm = calculateWpm(correctChars, durationSeconds);
    const rawAccuracy = calculateAccuracy(text.length, totalErrors);
    const uncorrectedErrors = countUncorrectedErrors(text, finalInput);
    const accuracy = calculateAccuracy(text.length, uncorrectedErrors);

    try {
      // Save the lesson
      await addDoc(collection(db, `users/${user.uid}/lessons`), {
        uid: user.uid,
        createdAt: serverTimestamp(),
        text: text,
        wpm,
        accuracy,
        rawAccuracy,
        duration: Math.round(durationSeconds),
        mistakes,
        bigrams: sessionBigrams,
      });

      // Update user stats atomically to prevent race conditions
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

      onComplete();
    } catch (error) {
      console.error("Failed to save lesson:", error);
      setSaving(false);
    }
  };

  const renderText = () => {
    charRefs.current = [];
    return text.split('').map((char, index) => {
      let color = 'text-zinc-500';

      if (index < input.length) {
        if (input[index] === char) {
          color = 'text-zinc-50';
        } else {
          color = 'text-red-500 bg-red-500/20 underline decoration-red-500 decoration-wavy';
        }
      } else if (index === input.length) {
        color = 'text-zinc-500 bg-zinc-800 animate-pulse';
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
    <div className="max-w-4xl mx-auto py-12 animate-in fade-in zoom-in-95 duration-300">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold tracking-tight">AI Typing Lesson</h2>
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
            <Button variant="outline" size="sm" onClick={togglePause} disabled={saving} className="text-zinc-400">
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
        className={`relative p-8 rounded-2xl bg-zinc-900 border border-zinc-800 text-2xl md:text-3xl leading-relaxed font-mono tracking-tight shadow-xl cursor-text ${paused ? 'select-none' : ''}`}
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
            <p className="text-sm text-zinc-500 mt-2">Click anywhere to resume</p>
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between text-zinc-400" role="status" aria-live="polite" aria-label="Typing statistics">
        <div className="flex gap-8">
          <div>
            <div className="text-sm uppercase tracking-wider font-semibold mb-1">Progress</div>
            <div className="text-xl font-mono text-zinc-50" aria-label={`Progress: ${Math.round((input.length / text.length) * 100) || 0} percent`}>{Math.round((input.length / text.length) * 100) || 0}%</div>
          </div>
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

        <div className="text-sm">
          Focus on accuracy over speed.
        </div>
      </div>
    </div>
  );
}
