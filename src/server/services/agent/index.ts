import type OpenAI from 'openai';

import { ApiError, type Vintage } from '../../envelope';
import { BUDGET, TOOLS } from './constants';
import { prefetchFor, type Prefetch } from './prefetch';
import { SYSTEM_PROMPT } from './prompt';
import { answerLocally, type LocalAnswer } from './local';
import { clientFor, endpoints, isRotatable, nextStart, type Endpoint } from './pool';
import { HANDLERS } from './tools';

/**
 * The AskAI endpoint.
 *
 * Structure follows api/services/agent.py, with one simplification: the Python
 * wrapped every model call in a ThreadPoolExecutor because the SDK's own
 * timeout was not reliably enforced from a sync FastAPI route. Here an
 * AbortSignal genuinely cancels the fetch, so the budget is expressed directly.
 *
 * The contract that matters: this never raises for a provider failure. Any
 * error at all falls through to the deterministic local answer, with the
 * reason prefixed into `note`. Only an empty question is a 400.
 */

export interface AskResult extends LocalAnswer {}

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * How much of a tool result the model is allowed to see, in bytes of JSON.
 *
 * The old rule was structural -- collapse below COMPACT_DEPTH, cap every list
 * at COMPACT_LIST_LEN -- and it applied whether or not the payload was
 * actually big. It was not: get_headline_index returns ~10KB against a 262k
 * token context, and depth-2 collapsing rewrote all twelve daily points as
 * the string "...". The model was handed a series with no numbers in it, so
 * it refused to state a level, which was the correct response to the data it
 * had and the wrong answer to the question.
 *
 * Budget by size instead: pass small results through untouched and trim only
 * what genuinely needs trimming. ~24KB is a few thousand tokens, comfortable
 * for two tool rounds.
 */
const MAX_TOOL_RESULT_BYTES = 24000;

/**
 * Cap on generated tokens. Generation time scales with output length, and the
 * slowest answers observed were the ones that rambled -- a 33s reply that
 * inventoried what it could not say. The prompt asks for under 150 words;
 * this stops a model that ignores it from spending the whole time budget.
 */
const MAX_OUTPUT_TOKENS = 1200;

/**
 * Turn the model's chain-of-thought off.
 *
 * inclusionai/ling-3.0-flash-vl reports `default_enabled: true`, and
 * reasoning tokens are billed against max_tokens. With a 900-token cap the
 * model spent the whole budget thinking and returned an EMPTY answer -- a
 * blank bubble in the UI. Reasoning also buys little here: the data is
 * handed over pre-fetched and the job is to report it in under 150 words.
 *
 * Safe for this model, which reports `mandatory: false`. A model that
 * requires reasoning would 400 on this, so it can be turned back on with
 * OPENROUTER_REASONING=1 without a code change.
 */
const REASONING_OFF = process.env.OPENROUTER_REASONING !== '1';

/**
 * Structural trim, used only once a result has blown the byte budget.
 * `maxDepth` is the level below which objects collapse; lists are capped at
 * COMPACT_LIST_LEN keeping BOTH ends, because every series here is
 * chronological and head-only trimming hides the newest point -- the one
 * "what is it right now" depends on.
 */
function compact(value: unknown, depth: number, maxDepth: number): unknown {
  if (Array.isArray(value)) {
    const deep = depth >= maxDepth;
    const render = (x: unknown) => (deep ? x : compact(x, depth + 1, maxDepth));
    const cap = BUDGET.COMPACT_LIST_LEN;
    if (value.length <= cap) return value.map(render);
    const head = Math.ceil(cap / 2);
    const tail = cap - head;
    return [
      ...value.slice(0, head).map(render),
      `... ${value.length - cap} items omitted (${value.length} total, ` +
        `first ${head} and last ${tail} shown)`,
      ...value.slice(value.length - tail).map(render),
    ];
  }
  if (value && typeof value === 'object') {
    if (depth >= maxDepth) return '...';
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, x]) => [
        k,
        compact(x, depth + 1, maxDepth),
      ]),
    );
  }
  return value;
}

/**
 * Serialise a tool result for the model, trimming only as hard as necessary.
 * COMPACT_DEPTH stays the floor, so the worst case is exactly the old
 * behaviour rather than something looser.
 */
function fit(result: unknown): string {
  const whole = JSON.stringify(result);
  if (whole.length <= MAX_TOOL_RESULT_BYTES) return whole;
  for (let maxDepth = 5; maxDepth > BUDGET.COMPACT_DEPTH; maxDepth--) {
    const text = JSON.stringify(compact(result, 0, maxDepth));
    if (text.length <= MAX_TOOL_RESULT_BYTES) return text;
  }
  return JSON.stringify(compact(result, 0, BUDGET.COMPACT_DEPTH));
}

async function askModel(
  v: Vintage,
  question: string,
  history: HistoryMessage[],
  pool: Endpoint[],
): Promise<AskResult> {
  const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const m of history) {
    if ((m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content) {
      messages.push({ role: m.role, content: m.content });
    }
  }
  const deadline = Date.now() + BUDGET.OVERALL_BUDGET_SECONDS * 1000;
  // Chosen once per question, not per call, so a single question walks the
  // pool in a stable order while successive questions start in different
  // places and spread across the per-account daily caps.
  const start = nextStart(pool.length);

  /**
   * The endpoint currently answering. Rotation happens *here*, around one
   * completion, rather than around the whole conversation: by the time a key
   * dies at tool-iteration two, `messages` already holds tool results that
   * cost real Postgres queries. Retrying at this level hands that accumulated
   * work to the next endpoint; retrying around askModel would throw it away
   * and run every tool again.
   */
  const state: { active: Endpoint | null; failovers: number } = { active: null, failovers: 0 };
  const toolsUsed: AskResult['tools_used'] = [];

  const complete = async (useTools: boolean): Promise<OpenAI.Chat.ChatCompletion> => {
    const rotated = pool.map((_, i) => pool[(start + i) % pool.length]);
    // Stickiness: an endpoint that has already answered in this conversation
    // goes first, so a multi-turn tool loop does not change model mid-thought
    // when entries carry different models.
    const held = state.active;
    const order = held ? [held, ...rotated.filter((e) => e !== held)] : rotated;

    const failures: string[] = [];
    for (const ep of order) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      try {
        const out = await clientFor(ep).chat.completions.create(
          {
            model: ep.model,
            messages,
            max_tokens: MAX_OUTPUT_TOKENS,
            ...(REASONING_OFF ? { reasoning: { enabled: false } } : {}),
            ...(useTools ? { tools: TOOLS as any, tool_choice: 'auto' as const } : {}),
          } as any,
          { signal: AbortSignal.timeout(Math.min(BUDGET.CALL_TIMEOUT_SECONDS * 1000, left)) },
        );
        // Count every endpoint that failed before this one answered. Keying
        // this off a change of `active` missed the first rotation of the
        // conversation, when nothing had answered yet.
        state.failovers += failures.length;
        state.active = ep;
        return out;
      } catch (e) {
        // Not this endpoint's fault -- a malformed request fails the same way
        // everywhere, so stop rather than spend the budget proving it.
        if (!isRotatable(e)) throw e;
        // Positional labels: the env var names are a server-side detail and
        // this string reaches the client through `note`.
        failures.push(`#${order.indexOf(ep) + 1} ${ep.model}: ${(e as Error).message}`);
      }
    }

    if (Date.now() >= deadline) {
      throw new Error(`exceeded the ${BUDGET.OVERALL_BUDGET_SECONDS}s AskAI time budget`);
    }
    throw new Error(
      `all ${pool.length} model endpoint(s) failed -- ${failures.join('; ')}`,
    );
  };

  const via = () =>
    state.failovers ? ` after ${state.failovers} endpoint failover(s)` : '';

  // Resolve the obvious tool before the model is asked anything. For a
  // recognised question this collapses two model calls into one: half the
  // latency, and half the spend against a 50/day free-tier cap.
  //
  // The result is folded into the question itself rather than sent as a
  // second user turn -- consecutive same-role messages are accepted by some
  // providers and rejected by others, and the pool is meant to make swapping
  // provider a config change.
  let userTurn = question;
  const pre = prefetchFor(question);
  if (pre.length) {
    const fetched = (
      await Promise.all(
        pre.map(async (p: Prefetch) => {
          const handler = HANDLERS[p.tool];
          if (!handler) return null;
          try {
            return { p, data: await handler(v, p.args) };
          } catch {
            // A prefetch miss is not an error: the model still has the tool
            // and can call it itself.
            return null;
          }
        }),
      )
    ).filter(Boolean) as { p: Prefetch; data: Record<string, unknown> }[];

    if (fetched.length) {
      for (const g of fetched) toolsUsed.push({ tool: g.p.tool, arguments: g.p.args });
      userTurn +=
        '\n\n---\nData retrieved for this question:\n\n' +
        fetched.map((g) => `### ${g.p.tool}\n${fit(g.data)}`).join('\n\n') +
        '\n\nAnswer the question above from this data. Call a tool only if ' +
        'something essential to the question is genuinely missing.';
    }
  }
  messages.push({ role: 'user', content: userTurn });

  for (let i = 0; i < BUDGET.MAX_TOOL_ITERATIONS; i++) {
    if (Date.now() > deadline) {
      throw new Error(`exceeded the ${BUDGET.OVERALL_BUDGET_SECONDS}s AskAI time budget`);
    }

    const completion = await complete(true);
    const message = completion.choices[0]?.message;
    const calls = message?.tool_calls ?? [];

    if (!calls.length) {
      // A model that returns no tool calls and no text has not answered.
      // Throwing hands it to the local fallback, because an empty bubble is
      // worse than a plainly-labelled deterministic answer.
      if (!(message?.content ?? '').trim()) {
        throw new Error('the model returned an empty answer');
      }
      return {
        answer: message?.content ?? '',
        tier: BUDGET.TIER_MODEL,
        tools_used: toolsUsed,
        // The model that actually answered, which after a failover is not
        // necessarily the one configured first. Reporting the configured
        // model here would be the same dishonesty as passing a canned answer
        // off as a generated one.
        model: state.active?.model ?? null,
        note: toolsUsed.length
          ? `Answered by ${state.active?.model} via ${toolsUsed.length} tool call(s)${via()}.`
          : `Answered by ${state.active?.model}${via()}.`,
      };
    }

    messages.push({ role: 'assistant', content: message?.content ?? null, tool_calls: calls });

    // Execute this round's tool calls concurrently. They are independent
    // reads against Postgres taking 84-600ms each; running them in sequence
    // just added their latencies together inside a 35s budget.
    const executed = await Promise.all(
      calls.map(async (tc) => {
        const fn = (tc as any).function;
        const name = fn?.name as string;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(fn?.arguments || '{}');
        } catch {
          args = {};
        }
        const handler = HANDLERS[name];
        if (!handler) return { tc, name, args, result: { error: `Unknown tool '${name}'.` } };
        try {
          return { tc, name, args, result: await handler(v, args) };
        } catch (e) {
          // Surfaced to the model so it can recover, never to the user.
          return { tc, name, args, result: { error: `Tool failed: ${(e as Error).message}` } };
        }
      }),
    );

    // Appended in call order, because a tool message must follow its call.
    for (const x of executed) {
      toolsUsed.push({ tool: x.name, arguments: x.args });
      messages.push({
        role: 'tool',
        tool_call_id: (x.tc as any).id,
        content: fit(x.result),
      });
    }
  }

  if (Date.now() > deadline) {
    throw new Error(`exceeded the ${BUDGET.OVERALL_BUDGET_SECONDS}s AskAI time budget`);
  }

  // Bounded loop exhausted: force an answer from what was gathered rather
  // than looping forever on a model that keeps calling tools.
  messages.push({
    role: 'user',
    content:
      'You have used the maximum number of tool calls allowed. Answer now ' +
      'using only the data already returned above. If it is not enough to ' +
      'answer fully, say so explicitly.',
  });
  const final = await complete(false);
  if (!(final.choices[0]?.message?.content ?? '').trim()) {
    throw new Error('the model returned an empty answer');
  }
  return {
    answer: final.choices[0]?.message?.content ?? '',
    tier: BUDGET.TIER_MODEL,
    tools_used: toolsUsed,
    model: state.active?.model ?? null,
    note: `Answered by ${state.active?.model} after reaching the tool-call limit${via()}.`,
  };
}

export async function ask(
  v: Vintage,
  question: string,
  history: HistoryMessage[] = [],
): Promise<AskResult> {
  if (!question || !question.trim()) {
    throw new ApiError('EMPTY_QUESTION', 'Ask a question first.', 400);
  }

  const pool = endpoints();

  if (!pool.length) {
    const out = await answerLocally(v, question);
    out.note =
      'AskAI has no model configured on this server ' +
      `(no OPENROUTER_API_KEY* is set). ${out.note}`;
    return out;
  }

  try {
    return await askModel(v, question, history, pool);
  } catch (e) {
    const reason = (e as Error)?.message || (e as Error)?.name || 'unknown error';
    const out = await answerLocally(v, question);
    out.note = `The language model could not answer this (${reason}). ${out.note}`;
    return out;
  }
}
