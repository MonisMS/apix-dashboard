import { ApiError, handler } from '@/server/envelope';
import { ask, type HistoryMessage } from '@/server/services/agent';

// A tool-calling round trip is slow and never cacheable.
export const dynamic = 'force-dynamic';
// Must exceed the agent's own 35s budget, or the platform truncates the
// request before the local fallback can run and the caller gets a bare 504.
export const maxDuration = 60;

export const POST = handler(async ({ request, vintage }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // FastAPI's pydantic model validated this shape for free; JSON does not.
    throw new ApiError('INVALID_BODY', 'Request body must be JSON.', 400);
  }

  const { question, history } = (body ?? {}) as {
    question?: unknown;
    history?: unknown;
  };

  if (typeof question !== 'string') {
    throw new ApiError('INVALID_BODY', '`question` must be a string.', 400);
  }

  // History is conversational context only. Tool call/result messages are
  // never accepted from the client: every tool invocation in an answer
  // happened in this request, against the published vintage.
  const turns: HistoryMessage[] = Array.isArray(history)
    ? (history as unknown[])
        .filter(
          (m): m is HistoryMessage =>
            !!m &&
            typeof m === 'object' &&
            ((m as HistoryMessage).role === 'user' ||
              (m as HistoryMessage).role === 'assistant') &&
            typeof (m as HistoryMessage).content === 'string',
        )
        .slice(-20)
    : [];

  return ask(vintage, question, turns);
});
