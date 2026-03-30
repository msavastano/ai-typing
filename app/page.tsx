'use client';

import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Keyboard, LogOut, Loader2, Play, Activity, Target, Trophy, ShieldCheck, Volume2, Moon } from 'lucide-react';
import { useState, useEffect } from 'react';
import { doc, onSnapshot, updateDoc, collection, query, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import TypingTest from '@/components/typing-test';
import KeyboardHeatmap from '@/components/keyboard-heatmap';

function Sparkline({ data, width = 200, height = 48 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const color = last >= prev ? '#10b981' : '#ef4444';

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Dot on latest point */}
      <circle
        cx={parseFloat(points[points.length - 1].split(',')[0])}
        cy={parseFloat(points[points.length - 1].split(',')[1])}
        r="3"
        fill={color}
      />
    </svg>
  );
}

const PRESET_TOPICS = [
  { value: 'general', label: 'General' },
  { value: 'technology', label: 'Technology' },
  { value: 'science', label: 'Science' },
  { value: 'fiction', label: 'Fiction' },
  { value: 'business', label: 'Business' },
  { value: 'history', label: 'History' },
  { value: 'programming', label: 'Programming' },
];

const PRESET_VALUES = new Set(PRESET_TOPICS.map(t => t.value));

export default function Home() {
  const { user, loading, signIn, logOut } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [recentLessons, setRecentLessons] = useState<any[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [topic, setTopic] = useState('general');
  const [strictMode, setStrictMode] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [calmMode, setCalmMode] = useState(false);

  useEffect(() => {
    if (!user) return;

    const unsubscribeStats = onSnapshot(doc(db, 'users', user.uid), (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setStats(data);
        if (data.topic) setTopic(data.topic);
        if (data.strictMode !== undefined) setStrictMode(data.strictMode);
        if (data.audioEnabled !== undefined) setAudioEnabled(data.audioEnabled);
        if (data.calmMode !== undefined) setCalmMode(data.calmMode);
      }
    });

    const q = query(
      collection(db, `users/${user.uid}/lessons`),
      orderBy('createdAt', 'desc'),
      limit(20)
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

  const handleTopicChange = async (newTopic: string) => {
    setTopic(newTopic);
    if (user) {
      await updateDoc(doc(db, 'users', user.uid), { topic: newTopic });
    }
  };

  const handleStrictModeToggle = async () => {
    const newValue = !strictMode;
    setStrictMode(newValue);
    if (user) {
      await updateDoc(doc(db, 'users', user.uid), { strictMode: newValue });
    }
  };

  const handleAudioToggle = async () => {
    const newValue = !audioEnabled;
    setAudioEnabled(newValue);
    if (user) {
      await updateDoc(doc(db, 'users', user.uid), { audioEnabled: newValue });
    }
  };

  const handleCalmModeToggle = async () => {
    const newValue = !calmMode;
    setCalmMode(newValue);
    if (user) {
      await updateDoc(doc(db, 'users', user.uid), { calmMode: newValue });
    }
  };

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

  const weakKeys = stats?.weakKeys && typeof stats.weakKeys === 'object' ? stats.weakKeys : {};
  const bigramData = stats?.bigrams && typeof stats.bigrams === 'object' ? stats.bigrams : {};

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
            weakKeys={weakKeys}
            bigrams={bigramData}
            avgWpm={stats?.avgWpm || 0}
            avgAccuracy={stats?.avgAccuracy || 0}
            totalLessons={stats?.totalLessons || 0}
            topic={topic}
            strictMode={strictMode}
            audioEnabled={audioEnabled}
            calmMode={calmMode}
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

            {/* Keyboard heatmap */}
            {Object.keys(weakKeys).length > 0 && (
              <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800">
                <h3 className="text-lg font-semibold mb-4">Weak Keys</h3>
                <KeyboardHeatmap weakKeys={weakKeys} />
              </div>
            )}

            {/* Topic selector */}
            <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800">
              <h3 className="text-lg font-semibold mb-3">Lesson Topic</h3>
              <div className="flex flex-wrap gap-2">
                {PRESET_TOPICS.map(t => (
                  <button
                    key={t.value}
                    onClick={() => handleTopicChange(t.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      topic === t.value
                        ? 'bg-emerald-600 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
                <button
                  onClick={() => { if (PRESET_VALUES.has(topic)) handleTopicChange('custom:'); }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    !PRESET_VALUES.has(topic)
                      ? 'bg-emerald-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  Custom
                </button>
              </div>
              {!PRESET_VALUES.has(topic) && (
                <input
                  type="text"
                  placeholder="e.g. cooking, music, sports..."
                  value={topic.startsWith('custom:') ? topic.slice(7) : topic}
                  onChange={(e) => handleTopicChange(`custom:${e.target.value}`)}
                  onBlur={(e) => {
                    const val = e.target.value.trim();
                    if (!val) handleTopicChange('general');
                  }}
                  className="mt-3 w-full max-w-xs px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-50 text-sm placeholder-zinc-500 focus:outline-none focus:border-emerald-600"
                  autoFocus
                />
              )}
            </div>

            {/* Strict mode toggle */}
            <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShieldCheck className={`h-5 w-5 ${strictMode ? 'text-emerald-500' : 'text-zinc-500'}`} />
                <div>
                  <h3 className="text-lg font-semibold">Strict Mode</h3>
                  <p className="text-sm text-zinc-400">Block advancing to the next letter until you type the correct one</p>
                </div>
              </div>
              <button
                onClick={handleStrictModeToggle}
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
                  strictMode ? 'bg-emerald-600' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 mt-1 ${
                    strictMode ? 'translate-x-6 ml-0.5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Audio feedback toggle */}
            <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Volume2 className={`h-5 w-5 ${audioEnabled ? 'text-emerald-500' : 'text-zinc-500'}`} />
                <div>
                  <h3 className="text-lg font-semibold">Audio Feedback</h3>
                  <p className="text-sm text-zinc-400">Play subtle sounds on keystrokes and errors to anchor focus</p>
                </div>
              </div>
              <button
                onClick={handleAudioToggle}
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
                  audioEnabled ? 'bg-emerald-600' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 mt-1 ${
                    audioEnabled ? 'translate-x-6 ml-0.5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Calm mode toggle */}
            <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Moon className={`h-5 w-5 ${calmMode ? 'text-emerald-500' : 'text-zinc-500'}`} />
                <div>
                  <h3 className="text-lg font-semibold">Calm Mode</h3>
                  <p className="text-sm text-zinc-400">Minimal interface with no animations — less visual noise, more focus</p>
                </div>
              </div>
              <button
                onClick={handleCalmModeToggle}
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
                  calmMode ? 'bg-emerald-600' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 mt-1 ${
                    calmMode ? 'translate-x-6 ml-0.5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* WPM Trend */}
            {recentLessons.length >= 2 && (
              <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">WPM Trend</h3>
                  <span className="text-sm text-zinc-500">Last {recentLessons.length} lessons</span>
                </div>
                <div className="flex items-center gap-6">
                  <Sparkline
                    data={[...recentLessons].reverse().map((l: any) => l.wpm)}
                    width={400}
                    height={64}
                  />
                  <div className="flex gap-6 text-sm text-zinc-400 shrink-0">
                    <div>
                      <div className="text-zinc-500">Low</div>
                      <div className="font-mono text-zinc-50">{Math.min(...recentLessons.map((l: any) => l.wpm))} WPM</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">High</div>
                      <div className="font-mono text-zinc-50">{Math.max(...recentLessons.map((l: any) => l.wpm))} WPM</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <h3 className="text-xl font-semibold">Recent Lessons</h3>
              {recentLessons.length === 0 ? (
                <div className="p-8 text-center rounded-2xl border border-dashed border-zinc-800 text-zinc-500">
                  No lessons completed yet. Start your first AI lesson!
                </div>
              ) : (
                <div className="space-y-3">
                  {recentLessons.slice(0, 5).map((lesson) => (
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
                          <div className="text-sm text-zinc-400">Raw</div>
                          <div className="font-medium text-zinc-500">{lesson.rawAccuracy ?? lesson.accuracy}%</div>
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
