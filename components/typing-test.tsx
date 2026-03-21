'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/firebase';
import { collection, addDoc, doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });

interface TypingTestProps {
  weakKeys: Record<string, number>;
  onComplete: () => void;
  onCancel: () => void;
}

export default function TypingTest({ weakKeys, onComplete, onCancel }: TypingTestProps) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [startTime, setStartTime] = useState<number | null>(null);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [mistakes, setMistakes] = useState<Record<string, number>>({});
  const [totalErrors, setTotalErrors] = useState(0);
  const [saving, setSaving] = useState(false);
  
  const inputRef = useRef<HTMLInputElement>(null);

  const generateLesson = useCallback(async () => {
    setLoading(true);
    try {
      // Find top 3 weakest keys
      const sortedKeys = Object.entries(weakKeys)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([k]) => k);
      
      let prompt = "Generate a single paragraph of text (around 30-40 words) for a typing test. Make it natural and coherent.";
      if (sortedKeys.length > 0) {
        prompt += ` The user struggles with the letters: ${sortedKeys.join(', ')}. Please include these letters frequently in the text to help them practice.`;
      }
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });
      
      const generatedText = response.text?.trim().replace(/\n/g, ' ') || "The quick brown fox jumps over the lazy dog.";
      setText(generatedText);
      setInput('');
      setStartTime(null);
      setEndTime(null);
      setMistakes({});
      setTotalErrors(0);
      
      // Focus input after generation
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (error) {
      console.error("Failed to generate lesson:", error);
      setText("The quick brown fox jumps over the lazy dog. This is a fallback text because the AI generation failed. Please try again later.");
    } finally {
      setLoading(false);
    }
  }, [weakKeys]);

  useEffect(() => {
    generateLesson();
  }, [generateLesson]);

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
      }
    }
    
    setInput(val);
    
    // Check if finished
    if (val.length === text.length) {
      setEndTime(Date.now());
      finishTest(val);
    }
  };

  const finishTest = async (finalInput: string) => {
    if (!user || !startTime) return;
    setSaving(true);
    
    const durationSeconds = (Date.now() - startTime) / 1000;
    const words = text.length / 5;
    const wpm = Math.round((words / durationSeconds) * 60);
    
    // Calculate accuracy based on total characters typed vs errors
    const accuracy = Math.max(0, Math.round(((text.length - totalErrors) / text.length) * 100));
    
    try {
      // 1. Save the lesson
      await addDoc(collection(db, `users/${user.uid}/lessons`), {
        uid: user.uid,
        createdAt: serverTimestamp(),
        text: text,
        wpm,
        accuracy,
        duration: Math.round(durationSeconds),
        mistakes: JSON.stringify(mistakes)
      });
      
      // 2. Update user stats
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        const userData = userSnap.data();
        const currentTotalLessons = userData.totalLessons || 0;
        const currentAvgWpm = userData.avgWpm || 0;
        const currentAvgAccuracy = userData.avgAccuracy || 0;
        const currentWeakKeys = JSON.parse(userData.weakKeys || '{}');
        
        // Merge weak keys
        const newWeakKeys = { ...currentWeakKeys };
        Object.entries(mistakes).forEach(([key, count]) => {
          newWeakKeys[key] = (newWeakKeys[key] || 0) + count;
        });
        
        // Calculate new averages
        const newTotalLessons = currentTotalLessons + 1;
        const newAvgWpm = ((currentAvgWpm * currentTotalLessons) + wpm) / newTotalLessons;
        const newAvgAccuracy = ((currentAvgAccuracy * currentTotalLessons) + accuracy) / newTotalLessons;
        
        await updateDoc(userRef, {
          totalLessons: newTotalLessons,
          avgWpm: newAvgWpm,
          avgAccuracy: newAvgAccuracy,
          weakKeys: JSON.stringify(newWeakKeys)
        });
      }
      
      onComplete();
    } catch (error) {
      console.error("Failed to save lesson:", error);
      setSaving(false);
    }
  };

  // Render text with highlighting
  const renderText = () => {
    return text.split('').map((char, index) => {
      let color = 'text-zinc-500'; // untyped
      
      if (index < input.length) {
        if (input[index] === char) {
          color = 'text-zinc-50'; // correct
        } else {
          color = 'text-red-500 bg-red-500/20'; // incorrect
        }
      } else if (index === input.length) {
        color = 'text-zinc-500 bg-zinc-800 animate-pulse'; // cursor
      }
      
      return (
        <span key={index} className={`transition-colors duration-75 ${color}`}>
          {char}
        </span>
      );
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 space-y-6">
        <Loader2 className="h-12 w-12 animate-spin text-emerald-500" />
        <p className="text-xl text-zinc-400 animate-pulse">Gemini is generating your personalized lesson...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-12 animate-in fade-in zoom-in-95 duration-300">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold tracking-tight">AI Typing Lesson</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={generateLesson} disabled={saving} className="text-zinc-400">
            <RefreshCw className="h-4 w-4 mr-2" />
            Skip
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving} className="text-zinc-400 hover:text-white">
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
        </div>
      </div>
      
      <div 
        className="relative p-8 rounded-2xl bg-zinc-900 border border-zinc-800 text-2xl md:text-3xl leading-relaxed font-mono tracking-tight shadow-xl cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {renderText()}
        
        {/* Hidden input for capturing keystrokes */}
        <input
          ref={inputRef}
          type="text"
          className="absolute opacity-0 pointer-events-none"
          value={input}
          onChange={handleInputChange}
          disabled={saving || !!endTime}
          autoFocus
        />
        
        {saving && (
          <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500 mb-4" />
            <p className="font-medium text-zinc-300">Saving your progress...</p>
          </div>
        )}
      </div>
      
      <div className="mt-8 flex items-center justify-between text-zinc-400">
        <div className="flex gap-8">
          <div>
            <div className="text-sm uppercase tracking-wider font-semibold mb-1">Progress</div>
            <div className="text-xl font-mono text-zinc-50">{Math.round((input.length / text.length) * 100) || 0}%</div>
          </div>
          <div>
            <div className="text-sm uppercase tracking-wider font-semibold mb-1">Errors</div>
            <div className="text-xl font-mono text-red-400">{totalErrors}</div>
          </div>
        </div>
        
        <div className="text-sm">
          Focus on accuracy over speed.
        </div>
      </div>
    </div>
  );
}
