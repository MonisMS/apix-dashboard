import OpenAI from 'openai';

import { BUDGET } from './constants';

/**
 * The model endpoint pool.
 *
 * Mirrors backend/apix/keypool.py in intent -- several free accounts treated
 * as one pool -- with one deliberate difference. The collector is a batch job,
 * so it probes every SerpApi balance at startup and hands out the fattest key.
 * AskAI is a request path with a 35s budget and a judge waiting, so a balance
 * probe per question would add latency to prevent a failure that usually is
 * not happening. Here the pool fails *over* on error instead of picking by
 * balance, and the quota probe is a separate, opt-in diagnostic.
 *
 * Why this is worth having at all: OpenRouter's free tier is capped per
 * account, not per key, at 50 model calls a day. One AskAI question costs two
 * calls (tools, then the answer), so a single account is ~20 questions/day.
 * Keys minted from different accounts have independent buckets and genuinely
 * add up; keys minted from the same account do not. `poolStatus()` reports
 * `workspace_id` precisely so that distinction stays checkable rather than
 * assumed.
 *
 * Configuration follows keypool.py's convention -- a prefix scan, so adding a
 * key is adding an env var and nothing else:
 *
 *     OPENROUTER_API_KEY=<yours>
 *     OPENROUTER_API_KEY_2=<teammate>
 *     OPENROUTER_API_KEY_3=<teammate>
 *
 * Each key may override the model and the base URL, which is what lets an
 * entry be a different provider (Groq, Cerebras and Gemini all speak the
 * OpenAI chat-completions dialect) rather than only a different key:
 *
 *     OPENROUTER_MODEL_2=nex-agi/nex-n2.5-mini:free
 *     OPENROUTER_BASE_URL_2=https://api.groq.com/openai/v1
 */

const KEY_PREFIX = 'OPENROUTER_API_KEY';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

export interface Endpoint {
  /** The env var that supplied the key. Diagnostics only -- never sent to a client. */
  env: string;
  key: string;
  baseURL: string;
  model: string;
}

/**
 * Every configured endpoint, in a stable order.
 *
 * Deduped by key value, because the same key really does get copied between
 * environments -- the two repos here held byte-identical keys. A duplicate in
 * the pool is worse than useless: a 429 on one rotates to its twin, which
 * shares the exhausted bucket and 429s too, burning budget to learn nothing.
 */
export function endpoints(): Endpoint[] {
  const found: { order: number; env: string; key: string; suffix: string }[] = [];

  for (const [name, raw] of Object.entries(process.env)) {
    if (!name.startsWith(KEY_PREFIX)) continue;
    const value = raw?.trim();
    if (!value) continue;
    const suffix = name.slice(KEY_PREFIX.length).replace(/^_/, '') || '1';
    // Numeric where possible so _10 sorts after _2 rather than before it.
    const order = /^\d+$/.test(suffix) ? Number(suffix) : Number.MAX_SAFE_INTEGER;
    found.push({ order, env: name, key: value, suffix });
  }

  found.sort((a, b) => a.order - b.order || a.env.localeCompare(b.env));

  const seen = new Set<string>();
  const out: Endpoint[] = [];
  for (const f of found) {
    if (seen.has(f.key)) continue;
    seen.add(f.key);
    out.push({
      env: f.env,
      key: f.key,
      baseURL:
        process.env[`OPENROUTER_BASE_URL_${f.suffix}`]?.trim() ||
        process.env.OPENROUTER_BASE_URL?.trim() ||
        DEFAULT_BASE_URL,
      model:
        process.env[`OPENROUTER_MODEL_${f.suffix}`]?.trim() ||
        process.env.OPENROUTER_MODEL?.trim() ||
        BUDGET.MODEL,
    });
  }
  return out;
}

const clients = new Map<string, OpenAI>();

export function clientFor(ep: Endpoint): OpenAI {
  const cached = clients.get(ep.key + ep.baseURL);
  if (cached) return cached;
  const api = new OpenAI({
    baseURL: ep.baseURL,
    apiKey: ep.key,
    // The pool is the retry strategy. Letting the SDK retry as well would
    // silently spend the time budget that rotation needs.
    maxRetries: 0,
    defaultHeaders: {
      'HTTP-Referer': process.env.APIX_PUBLIC_URL ?? 'http://localhost:3000',
      'X-Title': 'APIx AskAI',
    },
  });
  clients.set(ep.key + ep.baseURL, api);
  return api;
}

/**
 * Where the next question starts in the pool.
 *
 * Rotating the entry point spreads load across the daily buckets instead of
 * draining key 1 and only then discovering key 2. Module state, so it resets
 * on a cold start -- that is fine, it is a spreading heuristic and not a
 * ledger.
 */
let cursor = 0;
export function nextStart(size: number): number {
  if (size <= 0) return 0;
  const at = cursor % size;
  cursor = (cursor + 1) % size;
  return at;
}

/**
 * Whether a failure is worth trying the next endpoint for.
 *
 * The distinction earns its keep: a 400 is a malformed request -- a bad tool
 * schema, an over-long context -- and fails identically on every endpoint.
 * Rotating through the pool on a 400 would spend the whole 35s budget
 * rediscovering the same bug, and the local fallback would answer late
 * instead of promptly.
 */
export function isRotatable(e: unknown): boolean {
  const status =
    (e as { status?: number })?.status ??
    (e as { response?: { status?: number } })?.response?.status;

  if (typeof status === 'number') {
    // Our bug, not this endpoint's problem.
    if (status === 400 || status === 422) return false;
    // 401/403 dead key, 402 out of credit, 429 rate limited, 5xx provider
    // trouble -- all specific to this endpoint. 404 is a missing model, which
    // rotation fixes only when entries carry different models, but it fails
    // instantly so trying costs nothing worth protecting.
    return (
      status === 401 ||
      status === 402 ||
      status === 403 ||
      status === 404 ||
      status === 408 ||
      status === 429 ||
      status >= 500
    );
  }
  // No status at all: a timeout, an abort, a DNS or TLS failure. Always worth
  // another endpoint -- especially when it is a different provider.
  return true;
}

export interface EndpointStatus {
  env: string;
  model: string;
  ok: boolean;
  /** Distinct accounts have distinct workspaces; duplicates are not extra quota. */
  workspace_id: string | null;
  free_model_daily_requests: { used: number; limit: number; remaining: number } | null;
  error: string | null;
}

/**
 * Remaining free-tier quota per endpoint.
 *
 * `GET /api/v1/key` costs no inference, the same way SerpApi's /account costs
 * no search credit. Deliberately NOT called on the ask path: it is a
 * diagnostic, so that knowing the pool's health never slows down using it.
 */
export async function poolStatus(timeoutMs = 8000): Promise<EndpointStatus[]> {
  return Promise.all(
    endpoints().map(async (ep): Promise<EndpointStatus> => {
      const base: EndpointStatus = {
        env: ep.env,
        model: ep.model,
        ok: false,
        workspace_id: null,
        free_model_daily_requests: null,
        error: null,
      };
      // Only OpenRouter publishes this shape; another provider is reported as
      // configured rather than guessed at.
      if (!ep.baseURL.includes('openrouter.ai')) {
        return { ...base, ok: true, error: 'quota not reported by this provider' };
      }
      try {
        const r = await fetch(`${ep.baseURL}/key`, {
          headers: { Authorization: `Bearer ${ep.key}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!r.ok) return { ...base, error: `HTTP ${r.status}` };
        const d = (await r.json())?.data ?? {};
        return {
          ...base,
          ok: true,
          workspace_id: d.workspace_id ?? null,
          free_model_daily_requests: d.free_model_daily_requests ?? null,
        };
      } catch (e) {
        return { ...base, error: (e as Error).message.slice(0, 120) };
      }
    }),
  );
}
