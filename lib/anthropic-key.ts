// Anthropic API key is provided by the user and held only in sessionStorage,
// so it lives for the current browser session (cleared when the tab/window
// closes). It is never persisted to disk or sent anywhere except as a
// per-request header to our own API route, which forwards it to Anthropic.

const STORAGE_KEY = 'anthropic_api_key';

export function getAnthropicKey(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(STORAGE_KEY);
}

export function setAnthropicKey(key: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEY, key.trim());
}

export function clearAnthropicKey(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEY);
}
