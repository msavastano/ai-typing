'use client';

import { useAuth } from '@/lib/auth-context';
import { useState, useEffect } from 'react';
import { doc, onSnapshot, updateDoc, collection, query, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import TypingTest from '@/components/typing-test';
import KeyboardHeatmap from '@/components/keyboard-heatmap';

function Sparkline({ data, width = 340, height = 60 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 4;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });
  const lastPoint = points[points.length - 1].split(',');

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="#665f51"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={parseFloat(lastPoint[0])} cy={parseFloat(lastPoint[1])} r="3.5" fill="#665f51" />
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

const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];
const ROW_OFFSETS = [0, 18, 46];

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="relative inline-flex shrink-0 cursor-pointer rounded-full border-none p-0 transition-colors duration-200"
      style={{
        width: 44,
        height: 26,
        background: on ? '#665f51' : '#c9c5c1',
      }}
    >
      <span
        className="absolute rounded-full bg-white shadow-[0_1px_3px_rgba(40,34,24,0.2)] transition-all duration-200"
        style={{
          top: 3,
          left: on ? 21 : 3,
          width: 20,
          height: 20,
        }}
      />
    </button>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`bg-[#fcf9f6] border border-[#e5e2df] rounded-lg shadow-[0_1px_3px_rgba(40,34,24,0.05)] ${className}`}
    >
      {children}
    </div>
  );
}

export default function Home() {
  const { user, loading, signIn, logOut } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [recentLessons, setRecentLessons] = useState<any[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [topic, setTopic] = useState('general');
  const [strictMode, setStrictMode] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [calmMode, setCalmMode] = useState(false);
  const [sessionBlocks, setSessionBlocks] = useState(2);
  const [focusKeys, setFocusKeys] = useState<string[]>([]);

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

  // ── Loading ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#d9d1c0] text-[#2a2620]">
        <div className="h-8 w-8 rounded-full border-2 border-[#665f51] border-t-transparent animate-spin" />
      </div>
    );
  }

  // ── Landing ────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col bg-[#d9d1c0] text-[#2a2620]">
        <Nav user={null} onSignIn={signIn} onSignOut={() => {}} />
        <main className="flex-1 px-6">
          <section className="max-w-[640px] mx-auto pt-24 pb-16 text-center">
            <div className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-[#7b7771] mb-5">
              AI-powered typing tutor
            </div>
            <h1 className="font-serif font-bold text-[#2a2620] leading-[1.1] tracking-[-0.03em] mb-6"
                style={{ fontSize: 'clamp(2.8rem, 6vw, 4.5rem)' }}>
              Master typing<br />with AI
            </h1>
            <p className="text-[1.1rem] text-[#665f51] leading-[1.7] max-w-[460px] mx-auto mb-10">
              TypeMind analyzes your keystrokes and uses AI to generate
              personalized lessons targeting your weakest keys.
            </p>
            <button
              onClick={signIn}
              className="font-serif font-semibold text-base text-white bg-[#665f51] hover:bg-[#3d3830] border-none rounded-lg px-9 py-3.5 cursor-pointer transition-colors tracking-[0.01em]"
            >
              Begin your session
            </button>
          </section>

          <section className="max-w-[860px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-3 pb-12">
            {[
              { title: 'Personalized lessons', body: 'Every session is generated fresh based on your specific error patterns and keystroke data.' },
              { title: 'Real-time feedback', body: 'See exactly where you struggle — errors surface immediately so you can correct and learn.' },
              { title: 'Focused practice', body: 'Target individual keys, control session length, and choose topics that keep you engaged.' },
            ].map(f => (
              <div key={f.title} className="bg-[#fcf9f6] border border-[#e5e2df] rounded-lg p-5 shadow-[0_1px_3px_rgba(40,34,24,0.06)]">
                <div className="font-serif font-bold text-[0.95rem] text-[#2a2620] mb-2">{f.title}</div>
                <div className="font-serif text-[0.85rem] text-[#665f51] leading-[1.65]">{f.body}</div>
              </div>
            ))}
          </section>

          <section className="max-w-[640px] mx-auto pb-20">
            <div className="bg-[#fcf9f6] border border-[#dcd9d7] rounded-lg shadow-[0_2px_8px_rgba(40,34,24,0.07)] px-9 py-7">
              <div className="text-[0.65rem] font-medium uppercase tracking-[0.1em] text-[#7b7771] mb-4">
                Sample lesson
              </div>
              <div className="font-mono text-base leading-[2] tracking-[0.02em] mb-4">
                {'The shift key is your friend. Hold it firmly'.split('').map((ch, i) => (
                  <span
                    key={i}
                    style={{
                      color: i < 24 ? '#2a2620' : i === 24 ? 'transparent' : '#c9c5c1',
                      background: i === 24 ? 'rgba(102,95,81,0.15)' : 'transparent',
                      outline: i === 24 ? '1.5px solid #665f51' : 'none',
                      borderRadius: 2,
                    }}
                  >
                    {ch}
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                {['42 wpm', '97% accuracy', '2 errors'].map(p => (
                  <span
                    key={p}
                    className="font-serif text-[0.72rem] font-medium text-[#665f51] bg-[#f1edea] border border-[#e5e2df] rounded-full px-3 py-0.5"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const weakKeys = stats?.weakKeys && typeof stats.weakKeys === 'object' ? stats.weakKeys : {};
  const bigramData = stats?.bigrams && typeof stats.bigrams === 'object' ? stats.bigrams : {};

  // ── Typing session ────────────────────────────────────────────
  if (isTyping) {
    return (
      <div className="flex min-h-screen flex-col bg-[#d9d1c0] text-[#2a2620]">
        <Nav user={user} onSignIn={signIn} onSignOut={logOut} />
        <main className="flex-1">
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
            totalChunks={sessionBlocks}
            focusKeys={focusKeys}
            onComplete={() => setIsTyping(false)}
            onCancel={() => setIsTyping(false)}
          />
        </main>
      </div>
    );
  }

  // ── Dashboard ──────────────────────────────────────────────────
  const trend = recentLessons.length >= 2 ? [...recentLessons].reverse().map((l: any) => l.wpm) : [];

  return (
    <div className="flex min-h-screen flex-col bg-[#d9d1c0] text-[#2a2620]">
      <Nav user={user} onSignIn={signIn} onSignOut={logOut} />
      <main className="flex-1 pt-10 pb-20">
        <div className="max-w-[720px] mx-auto px-6 flex flex-col gap-3">

          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-serif text-[1.9rem] font-bold text-[#2a2620] tracking-[-0.02em]">Dashboard</h2>
            <button
              onClick={() => setIsTyping(true)}
              className="font-serif text-[0.9rem] font-semibold text-white bg-[#665f51] hover:bg-[#3d3830] border-none rounded-md px-5 py-2 cursor-pointer transition-colors"
            >
              Start AI lesson
            </button>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { label: 'Average WPM', value: Math.round(stats?.avgWpm || 0) },
              { label: 'Average accuracy', value: `${Math.round(stats?.avgAccuracy || 0)}%` },
              { label: 'Lessons completed', value: stats?.totalLessons || 0 },
            ].map(s => (
              <Card key={s.label} className="p-5 flex flex-col gap-1.5">
                <div className="font-serif text-[0.78rem] text-[#7b7771]">{s.label}</div>
                <div className="font-serif text-[2.4rem] font-bold text-[#2a2620] leading-none">{s.value}</div>
              </Card>
            ))}
          </div>

          {/* AI insight (only if there's actual data) */}
          {stats && (Object.keys(weakKeys).length > 0 || (stats?.totalLessons ?? 0) > 0) && (
            <div className="bg-[#fcf9f6] border border-[#e5e2df] border-l-[3px] border-l-[#665f51] rounded-md py-4 px-5 shadow-[0_1px_3px_rgba(40,34,24,0.05)]">
              <div className="font-serif text-[0.65rem] font-medium uppercase tracking-[0.1em] text-[#7b7771] mb-3">
                AI insight
              </div>
              <div className="font-serif text-[0.9rem] text-[#2a2620] leading-[1.65] italic">
                {Object.keys(weakKeys).length > 0
                  ? <>You consistently slow down on {topWeakKeys(weakKeys).map((k, i, arr) => (
                      <span key={k}>
                        <strong className="not-italic font-semibold">{k}</strong>{i < arr.length - 1 ? (i === arr.length - 2 ? ', and ' : ', ') : ''}
                      </span>
                    ))}. Focus on keeping your hands relaxed — tension slows your reach.</>
                  : <>Run your first lesson — TypeMind will start tracking your keystrokes and surface insights here.</>
                }
              </div>
            </div>
          )}

          {/* Weak keys */}
          {Object.keys(weakKeys).length > 0 && (
            <Card className="p-5">
              <div className="font-serif text-base font-bold text-[#2a2620] mb-1">Weak keys</div>
              <div className="font-serif text-[0.78rem] text-[#7b7771] mb-3.5">Keys where you make the most errors</div>
              <KeyboardHeatmap weakKeys={weakKeys} />
            </Card>
          )}

          {/* Lesson topic */}
          <Card className="p-5">
            <div className="font-serif text-base font-bold text-[#2a2620] mb-1">Lesson topic</div>
            <div className="font-serif text-[0.78rem] text-[#7b7771] mb-3.5">AI will generate text from this subject area</div>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_TOPICS.map(t => (
                <Chip
                  key={t.value}
                  active={topic === t.value}
                  onClick={() => handleTopicChange(t.value)}
                >
                  {t.label}
                </Chip>
              ))}
              <Chip
                active={!PRESET_VALUES.has(topic)}
                onClick={() => { if (PRESET_VALUES.has(topic)) handleTopicChange('custom:'); }}
              >
                Custom
              </Chip>
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
                className="mt-3 w-full max-w-xs px-3 py-2 rounded-md bg-[#f6f3f1] border border-[#dcd9d7] text-[#2a2620] text-sm placeholder-[#b5b0aa] focus:outline-none focus:border-[#665f51] font-serif"
                autoFocus
              />
            )}
          </Card>

          {/* Session length */}
          <Card className="p-5">
            <div className="font-serif text-base font-bold text-[#2a2620] mb-1">Session length</div>
            <div className="font-serif text-[0.78rem] text-[#7b7771] mb-3.5">Number of typing blocks per session</div>
            <div className="flex gap-2">
              {[1, 2, 3].map(n => (
                <button
                  key={n}
                  onClick={() => setSessionBlocks(n)}
                  className="font-serif text-[0.85rem] rounded-md px-5 py-1.5 cursor-pointer transition-colors border"
                  style={{
                    fontWeight: sessionBlocks === n ? 600 : 400,
                    color: sessionBlocks === n ? '#fff' : '#665f51',
                    background: sessionBlocks === n ? '#665f51' : '#f1edea',
                    borderColor: sessionBlocks === n ? '#665f51' : '#dcd9d7',
                  }}
                >
                  {n} {n === 1 ? 'block' : 'blocks'}
                </button>
              ))}
            </div>
          </Card>

          {/* Focus keys */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-1">
              <div className="font-serif text-base font-bold text-[#2a2620]">Focus keys</div>
              {focusKeys.length > 0 && (
                <button
                  onClick={() => setFocusKeys([])}
                  className="font-serif text-[0.72rem] text-[#7b7771] bg-transparent border-none cursor-pointer hover:text-[#2a2620] transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="font-serif text-[0.78rem] text-[#7b7771] mb-3.5">
              {focusKeys.length > 0
                ? `Lesson text will emphasize: ${focusKeys.map(k => k.toUpperCase()).join(', ')}`
                : 'Pick keys to practice, or leave empty to let AI decide'}
            </div>
            <div className="flex flex-col items-center gap-1.5">
              {ROWS.map((row, ri) => (
                <div key={ri} className="flex gap-1.5" style={{ paddingLeft: ROW_OFFSETS[ri] }}>
                  {row.map(k => {
                    const sel = focusKeys.includes(k);
                    return (
                      <button
                        key={k}
                        onClick={() => {
                          setFocusKeys(prev =>
                            prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]
                          );
                        }}
                        className="flex items-center justify-center w-[34px] h-[34px] font-mono text-xs font-semibold rounded-[5px] cursor-pointer transition-all"
                        style={{
                          background: sel ? '#665f51' : '#fcf9f6',
                          color: sel ? '#fff' : '#665f51',
                          border: sel ? '1px solid #665f51' : '1px solid #c9c5c1',
                          borderBottom: sel ? '3px solid #3d3830' : '3px solid #b5b0aa',
                        }}
                      >
                        {k}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </Card>

          {/* Toggles */}
          {[
            { label: 'Strict mode', sub: 'Block advancing to the next letter until you type the correct one', val: strictMode, set: handleStrictModeToggle },
            { label: 'Audio feedback', sub: 'Play subtle sounds on keystrokes and errors to anchor focus', val: audioEnabled, set: handleAudioToggle },
            { label: 'Calm mode', sub: 'Minimal interface with no animations — less visual noise, more focus', val: calmMode, set: handleCalmModeToggle },
          ].map(({ label, sub, val, set }) => (
            <Card key={label} className="p-5 flex items-center justify-between gap-4">
              <div>
                <div className="font-serif text-base font-semibold text-[#2a2620] mb-0.5">{label}</div>
                <div className="font-serif text-[0.8rem] text-[#7b7771] leading-[1.5]">{sub}</div>
              </div>
              <Toggle on={val} onChange={set} />
            </Card>
          ))}

          {/* WPM trend */}
          {trend.length >= 2 && (
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="font-serif text-base font-bold text-[#2a2620]">WPM trend</div>
                <span className="font-serif text-[0.72rem] text-[#7b7771]">Last {trend.length} lessons</span>
              </div>
              <div className="flex items-center gap-8 flex-wrap">
                <Sparkline data={trend} width={340} height={60} />
                <div className="flex gap-6">
                  {[
                    { label: 'Low', val: Math.min(...trend) },
                    { label: 'High', val: Math.max(...trend) },
                  ].map(s => (
                    <div key={s.label}>
                      <div className="font-serif text-[0.68rem] text-[#7b7771] mb-0.5">{s.label}</div>
                      <div className="font-mono text-[0.9rem] font-semibold text-[#2a2620]">{s.val} wpm</div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* Recent lessons */}
          <div>
            <h3 className="font-serif text-[1.1rem] font-bold text-[#2a2620] mb-2.5">Recent lessons</h3>
            {recentLessons.length === 0 ? (
              <div className="bg-[#fcf9f6] border border-dashed border-[#dcd9d7] rounded-lg p-8 text-center font-serif text-[0.9rem] text-[#7b7771]">
                No lessons completed yet. Start your first AI lesson.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {recentLessons.slice(0, 5).map((lesson) => (
                  <div
                    key={lesson.id}
                    className="flex items-center bg-[#fcf9f6] border border-[#e5e2df] rounded-md py-3 px-4.5 gap-4"
                    style={{ paddingLeft: 18, paddingRight: 18 }}
                  >
                    <div className="flex-1">
                      <div className="font-serif text-base font-bold text-[#2a2620]">{lesson.wpm} WPM</div>
                      <div className="font-serif text-[0.75rem] text-[#7b7771]">
                        {lesson.createdAt?.toDate ? new Date(lesson.createdAt.toDate()).toLocaleDateString() : ''}
                      </div>
                    </div>
                    {[
                      { label: 'Accuracy', val: `${lesson.accuracy}%` },
                      { label: 'Raw', val: `${lesson.rawAccuracy ?? lesson.accuracy}%` },
                      { label: 'Duration', val: `${lesson.duration}s` },
                    ].map(s => (
                      <div key={s.label} className="text-right">
                        <div className="font-serif text-[0.68rem] text-[#7b7771]">{s.label}</div>
                        <div className="font-serif text-[0.9rem] font-semibold text-[#665f51]">{s.val}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function topWeakKeys(weakKeys: Record<string, number>): string[] {
  return Object.entries(weakKeys)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([k]) => k);
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="font-serif text-[0.82rem] rounded-full px-4 py-1 cursor-pointer transition-all border"
      style={{
        fontWeight: active ? 600 : 400,
        color: active ? '#fff' : '#665f51',
        background: active ? '#665f51' : '#f1edea',
        borderColor: active ? '#665f51' : '#dcd9d7',
      }}
    >
      {children}
    </button>
  );
}

function Nav({
  user,
  onSignIn,
  onSignOut,
}: {
  user: { email?: string | null } | null;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  return (
    <nav className="flex items-center px-10 h-14 bg-[#fcf9f6] border-b border-[#e5e2df] sticky top-0 z-10">
      <div className="cursor-pointer mr-8 shrink-0">
        <span className="font-serif font-bold text-[1.1rem] text-[#2a2620] tracking-[-0.02em]">TypeMind</span>
      </div>
      <div className="flex items-center gap-4 ml-auto">
        {user ? (
          <>
            <span className="font-serif text-[0.8rem] text-[#7b7771] hidden sm:block">{user.email}</span>
            <button
              onClick={onSignOut}
              className="font-serif text-[0.8rem] text-[#665f51] bg-transparent border border-[#c9c5c1] rounded-md px-3 py-1 cursor-pointer hover:bg-[#f1edea] transition-colors"
            >
              Sign out
            </button>
          </>
        ) : (
          <button
            onClick={onSignIn}
            className="font-serif text-[0.875rem] font-semibold text-white bg-[#665f51] hover:bg-[#3d3830] border-none rounded-md px-4 py-1.5 cursor-pointer transition-colors"
          >
            Sign in
          </button>
        )}
      </div>
    </nav>
  );
}
