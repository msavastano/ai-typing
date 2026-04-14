import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
  chunkIndex?: number;  // 0-based index within a multi-chunk session
  totalChunks?: number; // total chunks in the session
  focusKeys?: string[]; // user-chosen keys to focus on (overrides AI-detected weak keys)
}

// Vary the angle/framing per chunk so the AI doesn't produce near-identical text
const CHUNK_VARIETY = [
  'Use a narrative or storytelling angle.',
  'Use a factual or informational angle.',
  'Use a descriptive or observational angle.',
];

function buildPrompt(data: GenerateRequest): string {
  const { weakKeys, bigrams, avgWpm, avgAccuracy, totalLessons } = data;
  const chunkIndex = data.chunkIndex ?? 0;
  const totalChunks = data.totalChunks ?? 1;
  // Strip "custom:" prefix if present
  const topic = data.topic.startsWith('custom:') ? data.topic.slice(7).trim() || 'general' : data.topic;

  // Determine difficulty tier
  let difficulty: string;
  let wordCount: string;
  if (totalLessons < 5 || avgWpm < 25) {
    difficulty = 'Use simple, common words with short sentences.';
    wordCount = '25-35';
  } else if (avgWpm < 45 || avgAccuracy < 85) {
    difficulty = 'Use moderately complex vocabulary with varied sentence structure.';
    wordCount = '35-50';
  } else {
    difficulty = 'Use rich vocabulary, varied punctuation (commas, semicolons, dashes), and include some numbers or capitalized proper nouns.';
    wordCount = '50-70';
  }

  // Use user-chosen focus keys if provided, otherwise fall back to AI-detected weak keys
  const sortedKeys = data.focusKeys && data.focusKeys.length > 0
    ? data.focusKeys.slice(0, 8)
    : Object.entries(weakKeys)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([k]) => k);

  // Top bigram confusions (e.g., "expected r but typed t")
  const sortedBigrams = Object.entries(bigrams)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([k]) => k);

  // Decide exercise type: beginners with weak keys get focused drills sometimes,
  // programming topic gets code-like text sometimes
  const isBeginnerWithWeakKeys = (totalLessons < 5 || avgWpm < 25) && sortedKeys.length > 0;
  const useDrill = isBeginnerWithWeakKeys && Math.random() < 0.4;
  const useCodeSnippet = topic === 'programming' && !useDrill && Math.random() < 0.5;

  let prompt: string;

  if (useDrill) {
    prompt = `Generate a focused typing drill (around ${wordCount} words) that builds muscle memory for these keys: ${sortedKeys.join(', ')}. Use a variety of real, common short words that feature those letters. Do NOT repeat any word more than twice. Vary sentence structure — for example "jeff fed the fluffy fox five figs and found fresh fruit" for the letter f.`;
  } else if (useCodeSnippet) {
    prompt = `Generate a realistic-looking code snippet (around ${wordCount} words worth of text) for a typing test. Use common programming patterns: variable declarations, function calls, if/else blocks, loops, string literals, comments. Use symbols programmers type often: = {} () [] ; : . , < > / " ' \` _ - + && ||. Output plain text that looks like code but can be typed as a single continuous block with no actual line breaks.`;
    if (sortedKeys.length > 0) {
      prompt += ` Include variable/function names that use these letters the user struggles with: ${sortedKeys.join(', ')}.`;
    }
  } else {
    const variety = CHUNK_VARIETY[chunkIndex % CHUNK_VARIETY.length];
    prompt = `Generate a single paragraph of plain prose (around ${wordCount} words) for a typing test. ${difficulty} ${variety}`;

    // Topic guidance
    if (topic && topic !== 'general') {
      prompt += ` Write about the topic: ${topic}.`;
    }

    if (totalChunks > 1) {
      prompt += ` This is exercise ${chunkIndex + 1} of ${totalChunks} in a session — make the content distinct from other exercises on this topic.`;
    }
  }

  // Weak keys targeting (for prose and code modes)
  if (!useDrill && sortedKeys.length > 0) {
    prompt += ` The user struggles with these letters: ${sortedKeys.join(', ')}. Include words that use these letters frequently.`;
  }

  // Bigram confusion targeting
  if (sortedBigrams.length > 0) {
    const bigramDescriptions = sortedBigrams.map(b => {
      const [expected, typed] = b.split('→');
      return `confuses "${expected}" with "${typed}"`;
    });
    prompt += ` The user often ${bigramDescriptions.join(', and ')}. Include words that help practice the correct keys.`;
  }

  prompt += ' Do not repeat any word more than 3 times in the entire text. Output ONLY the text. No quotes, no markdown, no labels, no bullet points.';

  return prompt;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests. Please wait before generating another lesson.' }, { status: 429 });
  }

  try {
    const body: GenerateRequest = await request.json();

    const prompt = buildPrompt(body);

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
      contents: prompt,
      config: { temperature: 1.2 },
    });

    const text = response.text?.trim().replace(/\n/g, ' ').replace(/\s+/g, ' ') || null;

    if (!text) {
      return NextResponse.json({ error: 'Empty response from AI' }, { status: 502 });
    }

    return NextResponse.json({ text });
  } catch (error) {
    console.error('Generate lesson error:', error);
    return NextResponse.json({ error: 'Failed to generate lesson' }, { status: 500 });
  }
}
