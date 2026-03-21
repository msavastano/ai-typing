'use client';

import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Keyboard, LogOut, Loader2, Play, Activity, Target, Trophy } from 'lucide-react';
import { useState, useEffect } from 'react';
import { doc, onSnapshot, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import TypingTest from '@/components/typing-test';

export default function Home() {
  const { user, loading, signIn, logOut } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [recentLessons, setRecentLessons] = useState<any[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    if (!user) return;

    // Listen to user stats
    const unsubscribeStats = onSnapshot(doc(db, 'users', user.uid), (doc) => {
      if (doc.exists()) {
        setStats(doc.data());
      }
    });

    // Listen to recent lessons
    const q = query(
      collection(db, `users/${user.uid}/lessons`),
      orderBy('createdAt', 'desc'),
      limit(5)
    );
    const unsubscribeLessons = onSnapshot(q, (snapshot) => {
      const lessons = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRecentLessons(lessons);
    });

    return () => {
      unsubscribeStats();
      unsubscribeLessons();
    };
  }, [user]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-50">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-50">
        <header className="flex items-center justify-between p-6 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Keyboard className="h-6 w-6 text-emerald-500" />
            <span className="text-xl font-bold tracking-tight">TypeMind</span>
          </div>
          <Button onClick={signIn} variant="outline" className="text-zinc-950">
            Sign In
          </Button>
        </header>
        <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6">
            Master typing with <span className="text-emerald-500">AI</span>
          </h1>
          <p className="text-xl text-zinc-400 max-w-2xl mb-10">
            TypeMind analyzes your keystrokes and uses Gemini AI to generate personalized typing lessons targeting your weakest keys.
          </p>
          <Button onClick={signIn} size="lg" className="text-lg px-8 py-6 bg-emerald-600 hover:bg-emerald-700 text-white border-none">
            Get Started for Free
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-50">
      <header className="flex items-center justify-between p-6 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Keyboard className="h-6 w-6 text-emerald-500" />
          <span className="text-xl font-bold tracking-tight">TypeMind</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm text-zinc-400 hidden sm:block">{user.email}</div>
          <Button onClick={logOut} variant="ghost" size="icon" className="text-zinc-400 hover:text-white">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {isTyping ? (
          <TypingTest 
            weakKeys={stats?.weakKeys ? JSON.parse(stats.weakKeys) : {}} 
            onComplete={() => setIsTyping(false)} 
            onCancel={() => setIsTyping(false)} 
          />
        ) : (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
              <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
              <Button onClick={() => setIsTyping(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <Play className="h-4 w-4 mr-2" />
                Start AI Lesson
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 flex flex-col">
                <div className="flex items-center gap-2 text-zinc-400 mb-2">
                  <Activity className="h-5 w-5" />
                  <span className="font-medium">Average WPM</span>
                </div>
                <div className="text-4xl font-bold">{Math.round(stats?.avgWpm || 0)}</div>
              </div>
              
              <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 flex flex-col">
                <div className="flex items-center gap-2 text-zinc-400 mb-2">
                  <Target className="h-5 w-5" />
                  <span className="font-medium">Average Accuracy</span>
                </div>
                <div className="text-4xl font-bold">{Math.round(stats?.avgAccuracy || 0)}%</div>
              </div>
              
              <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 flex flex-col">
                <div className="flex items-center gap-2 text-zinc-400 mb-2">
                  <Trophy className="h-5 w-5" />
                  <span className="font-medium">Lessons Completed</span>
                </div>
                <div className="text-4xl font-bold">{stats?.totalLessons || 0}</div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-xl font-semibold">Recent Lessons</h3>
              {recentLessons.length === 0 ? (
                <div className="p-8 text-center rounded-2xl border border-dashed border-zinc-800 text-zinc-500">
                  No lessons completed yet. Start your first AI lesson!
                </div>
              ) : (
                <div className="space-y-3">
                  {recentLessons.map((lesson) => (
                    <div key={lesson.id} className="flex items-center justify-between p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
                      <div className="flex flex-col">
                        <span className="font-medium">{lesson.wpm} WPM</span>
                        <span className="text-sm text-zinc-500">{new Date(lesson.createdAt?.toDate()).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-sm text-zinc-400">Accuracy</div>
                          <div className="font-medium">{lesson.accuracy}%</div>
                        </div>
                        <div className="text-right hidden sm:block">
                          <div className="text-sm text-zinc-400">Duration</div>
                          <div className="font-medium">{lesson.duration}s</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
