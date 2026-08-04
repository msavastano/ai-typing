import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import {
  varietyIndex,
  maxSimilarity,
  recentOpenings,
  SIMILARITY_THRESHOLD,
} from '@/lib/lesson-variety';
import { planLesson, renderLessonPrompt, planSummary, type PlanInput } from '@/lib/curriculum';
import { toTypeableText } from '@/lib/typeable-text';
import type { StruggleKey } from '@/lib/skill-model';

// Simple in-memory rate limiter: max 10 requests per minute per IP
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

interface GenerateRequest {
  weakKeys: Record<string, number>;
  bigrams: Record<string, number>;
  avgWpm: number;
  avgAccuracy: number;
  totalLessons: number;
  topic: string;
  chunkIndex?: number;    // 0-based index within a multi-chunk session
  totalChunks?: number;   // total chunks in the session
  focusKeys?: string[];   // user-chosen keys, overriding the skill model
  recentTexts?: string[]; // lessons the user has already typed, newest first
  varietyNonce?: number;  // bumped by the client on Skip / Practice again
  // Skill model (preferred over the raw weakKeys/avg fields when present).
  struggleKeys?: StruggleKey[];
  masteredKeys?: string[];
  slowDigraphs?: string[];
  recentWpm?: number | null;
  recentAccuracy?: number | null;
}

/** Cap what we accept from the client so a large body can't bloat the prompt. */
const MAX_RECENT_TEXTS = 12;

/** Strip the "custom:" prefix the topic picker uses for free-text topics. */
function normalizeTopic(topic: string): string {
  if (!topic) return 'general';
  return topic.startsWith('custom:') ? topic.slice(7).trim() || 'general' : topic;
}

/**
 * Translate a request into planner input. The planner owns every teaching
 * decision; this only picks the best available source for each field.
 *
 * `offset` shifts the rotation index. The first attempt uses 0; a regeneration
 * after a detected repeat uses 1, which changes framing and often the mode too.
 */
function toPlanInput(data: GenerateRequest, offset = 0): PlanInput {
  const chunkIndex = data.chunkIndex ?? 0;
  const totalChunks = data.totalChunks ?? 1;

  // Prefer the trailing-window level over the lifetime average, which never
  // decays and would otherwise pin an improving user to their first week.
  const level = typeof data.recentWpm === 'number' ? data.recentWpm : data.avgWpm;
  const levelAccuracy = typeof data.recentAccuracy === 'number' ? data.recentAccuracy : data.avgAccuracy;

  // Fall back to the legacy raw error counts when the skill model has not yet
  // gathered enough evidence to rank anything.
  const struggleKeys: StruggleKey[] = data.struggleKeys?.length
    ? data.struggleKeys
    : Object.entries(data.weakKeys ?? {})
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([key]) => ({ key, score: 0, reason: 'accuracy' as const }));

  const confusions = Object.entries(data.bigrams ?? {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([pair]) => pair);

  return {
    index: varietyIndex(data.totalLessons, chunkIndex, data.varietyNonce ?? 0) + offset,
    totalLessons: data.totalLessons,
    level,
    levelAccuracy,
    topic: normalizeTopic(data.topic),
    struggleKeys,
    masteredKeys: data.masteredKeys ?? [],
    focusKeys: data.focusKeys ?? [],
    slowDigraphs: data.slowDigraphs ?? [],
    confusions,
    chunkIndex,
    totalChunks,
  };
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests. Please wait before generating another lesson.' }, { status: 429 });
  }

  const apiKey = request.headers.get('x-gemini-api-key')?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing Gemini API key. Add your key in the dashboard to generate lessons.' }, { status: 401 });
  }

  try {
    const body: GenerateRequest = await request.json();
    const recentTexts = (body.recentTexts ?? []).slice(0, MAX_RECENT_TEXTS);
    const openings = recentOpenings(recentTexts);

    const ai = new GoogleGenAI({ apiKey });

    const attempt = async (offset: number) => {
      const plan = planLesson(toPlanInput(body, offset));
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: renderLessonPrompt(plan, openings),
        config: {
          temperature: 1.2,
          seed: Math.floor(Math.random() * 2_147_483_647),
        },
      });
      // Models reach for em dashes and curly quotes, which have no key on a
      // standard keyboard and would make the lesson impossible to complete.
      const text = toTypeableText(response.text ?? '') || null;
      return { plan, text };
    };

    let { plan, text } = await attempt(0);

    if (!text) {
      return NextResponse.json({ error: 'Empty response from AI' }, { status: 502 });
    }

    // The prompt asks the model not to repeat itself, but small models drift back
    // to their favourite openings. Verify, and give it exactly one more attempt
    // under a shifted rotation before accepting the closer of the two.
    let score = maxSimilarity(text, recentTexts);
    if (score > SIMILARITY_THRESHOLD) {
      const retry = await attempt(1);
      if (retry.text) {
        const retryScore = maxSimilarity(retry.text, recentTexts);
        if (retryScore < score) {
          text = retry.text;
          plan = retry.plan;
          score = retryScore;
        }
      }
    }

    return NextResponse.json({
      text,
      repeated: score > SIMILARITY_THRESHOLD,
      // Surfaced so the user can see what this lesson is for, and so the plan is
      // inspectable rather than buried in a prompt string.
      focus: planSummary(plan),
      mode: plan.mode,
      rationale: plan.rationale,
    });
  } catch (error) {
    console.error('Generate lesson error:', error);
    const message = error instanceof Error ? error.message : '';
    // Surface key problems clearly so the user can fix their key
    if (/api[_ ]?key|permission|unauthenticated|invalid|403|401|400/i.test(message)) {
      return NextResponse.json({ error: 'Gemini rejected your API key. Check that it is valid and try again.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to generate lesson' }, { status: 500 });
  }
}
