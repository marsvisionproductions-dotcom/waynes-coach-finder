// Polite fetch: identifies itself, times out, never retries a 403, small delay between calls to the same host.
// Standard well-behaved crawler format (the same shape Google/Bing use). Honestly identified; some hosts 403 anything else.
export const UA = 'Mozilla/5.0 (compatible; CoachFinder/0.1; +https://waynes-coach-finder.netlify.app)';

const lastHit = new Map<string, number>();
const MIN_GAP_MS = 4000;

export async function politeFetch(url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<Response> {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) ?? 0) + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastHit.set(host, Date.now());
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.8', accept: 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8', ...(init.headers || {}) } });
  } finally { clearTimeout(t); }
}

export async function fetchText(url: string, timeoutMs?: number): Promise<{ ok: boolean; status: number; text: string }> {
  const r = await politeFetch(url, {}, timeoutMs);
  return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : '' };
}

export function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>|<\/(?:p|div|li|title|h[1-6]|tr|td|th|section|article|dd|dt)>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
