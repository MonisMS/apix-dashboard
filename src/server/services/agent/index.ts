import OpenAI from 'openai';

import { ApiError, type Vintage } from '../../envelope';
import { BUDGET, SYSTEM_PROMPT, TOOLS } from './constants';
import { answerLocally, type LocalAnswer } from './local';
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

const MODEL = process.env.OPENROUTER_MODEL || BUDGET.MODEL;

export interface AskResult extends LocalAnswer {}

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Trim a tool result before it goes back to the model: collapse anything
 * nested deeper than two levels and cap long lists. Full payloads are tens of
 * kilobytes and would crowd out the conversation.
 */
function compact(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    if (depth >= BUDGET.COMPACT_DEPTH) {
      return value.length > BUDGET.COMPACT_LIST_LEN
        ? [...value.slice(0, BUDGET.COMPACT_LIST_LEN), `... ${value.length} items total`]
        : value;
    }
    const head = value.slice(0, BUDGET.COMPACT_LIST_LEN).map((x) => compact(x, depth + 1));
    return value.length > BUDGET.COMPACT_LIST_LEN
      ? [...head, `... ${value.length} items total`]
      : head;
  }
  if (value && typeof value === 'object') {
    if (depth >= BUDGET.COMPACT_DEPTH) return '...';
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, x]) => [k, compact(x, depth + 1)]),
    );
  }
  return value;
}

function client(): OpenAI {
  return new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    maxRetries: 0,
    defaultHeaders: {
      'HTTP-Referer': process.env.APIX_PUBLIC_URL ?? 'http://localhost:3000',
      'X-Title': 'APIx AskAI',
    },
  });
}

async function askModel(
  v: Vintage,
  question: string,
  history: HistoryMessage[],
): Promise<AskResult> {
  const api = client();
  const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const m of history) {
    if ((m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content) {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: 'user', content: question });

  const deadline = Date.now() + BUDGET.OVERALL_BUDGET_SECONDS * 1000;
  const complete = (useTools: boolean) => {
    const left = deadline - Date.now();
    if (left <= 0) {
      throw new Error(`exceeded the ${BUDGET.OVERALL_BUDGET_SECONDS}s AskAI time budget`);
    }
    const budget = Math.min(BUDGET.CALL_TIMEOUT_SECONDS * 1000, left);
    return api.chat.completions.create(
      {
        model: MODEL,
        messages,
        ...(useTools ? { tools: TOOLS as any, tool_choice: 'auto' as const } : {}),
      },
      { signal: AbortSignal.timeout(budget) },
    );
  };

  const toolsUsed: AskResult['tools_used'] = [];

  for (let i = 0; i < BUDGET.MAX_TOOL_ITERATIONS; i++) {
    if (Date.now() > deadline) {
      throw new Error(`exceeded the ${BUDGET.OVERALL_BUDGET_SECONDS}s AskAI time budget`);
    }

    const completion = await complete(true);
    const message = completion.choices[0]?.message;
    const calls = message?.tool_calls ?? [];

    if (!calls.length) {
      return {
        answer: message?.content ?? '',
        tier: BUDGET.TIER_MODEL,
        tools_used: toolsUsed,
        model: MODEL,
        note: toolsUsed.length
          ? `Answered by ${MODEL} via ${toolsUsed.length} tool call(s).`
          : `Answered by ${MODEL}.`,
      };
    }

    messages.push({ role: 'assistant', content: message?.content ?? null, tool_calls: calls });

    for (const tc of calls) {
      const fn = (tc as any).function;
      const name = fn?.name as string;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(fn?.arguments || '{}');
      } catch {
        args = {};
      }
      let result: Record<string, unknown>;
      const handler = HANDLERS[name];
      if (!handler) {
        result = { error: `Unknown tool '${name}'.` };
      } else {
        try {
          result = await handler(v, args);
        } catch (e) {
          // Surfaced to the model so it can recover, never to the user.
          result = { error: `Tool failed: ${(e as Error).message}` };
        }
      }
      toolsUsed.push({ tool: name, arguments: args });
      messages.push({
        role: 'tool',
        tool_call_id: (tc as any).id,
        content: JSON.stringify(compact(result)),
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
  return {
    answer: final.choices[0]?.message?.content ?? '',
    tier: BUDGET.TIER_MODEL,
    tools_used: toolsUsed,
    model: MODEL,
    note: `Answered by ${MODEL} after reaching the tool-call limit.`,
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

  if (!process.env.OPENROUTER_API_KEY) {
    const out = await answerLocally(v, question);
    out.note =
      'AskAI has no model configured on this server ' +
      `(OPENROUTER_API_KEY is not set). ${out.note}`;
    return out;
  }

  try {
    return await askModel(v, question, history);
  } catch (e) {
    const reason = (e as Error)?.message || (e as Error)?.name || 'unknown error';
    const out = await answerLocally(v, question);
    out.note = `The language model could not answer this (${reason}). ${out.note}`;
    return out;
  }
}
