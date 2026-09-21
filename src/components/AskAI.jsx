import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { renderMarkdown } from './askai-markdown';
import { useAsk } from '../api';
import { CopilotIcon } from './CopilotIcon';

const STATIC = process.env.NEXT_PUBLIC_API_STATIC === '1';

const SUGGESTIONS = [
  'Why did fares move this week?',
  'Which route is cheapest right now?',
  'Explain the Jevons and Young formulas',
  'Why are booking windows indexed separately?',
  'How are route and carrier weights derived?',
  'How does this compare against MoSPI?',
  'Where does the data come from?',
];

/** "get_route_detail" -> "route detail" */
function toolLabel(name) {
  return name.replace(/^get_|^list_/, '').replace(/_/g, ' ');
}

function Bubble({ message }) {
  const isUser = message.role === 'user';
  const isError = message.role === 'error';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'px-3 py-2 text-sm',
          // Tables and figures need room; only the user's own text is inset.
          isUser || isError ? 'max-w-[85%]' : 'w-full min-w-0',
          isUser && 'whitespace-pre-wrap bg-primary text-primary-foreground',
          !isUser && !isError && 'bg-accent text-accent-foreground [&_p+p]:mt-2',
          isError && 'whitespace-pre-wrap border border-destructive/40 bg-destructive/10 text-destructive',
        )}
      >
        {isUser || isError ? message.content : renderMarkdown(message.content)}
        {!isUser && !isError && (message.note || !!message.tools_used?.length) && (
          <div className="mt-2 flex flex-col gap-1.5 border-t border-border/60 pt-2">
            {!!message.tools_used?.length && (
              <div className="flex flex-wrap gap-1">
                {message.tools_used.map((t, i) => (
                  <Badge key={`${t.tool}-${i}`} variant="outline" className="text-[10px]">
                    {toolLabel(t.tool)}
                  </Badge>
                ))}
              </div>
            )}
            {message.note && (
              <div className="flex items-start gap-1 text-[11px] text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                <span>{message.note}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AskAI({ trigger }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const ask = useAsk();
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, ask.isPending]);

  function send(question) {
    const q = (question ?? input).trim();
    if (!q || ask.isPending) return;
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content: q }]);
    setInput('');
    ask.mutate(
      { question: q, history },
      {
        onSuccess: (data) => {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: data.answer,
              tools_used: data.tools_used,
              tier: data.tier,
              model: data.model,
              note: data.note,
            },
          ]);
        },
        onError: (err) => {
          setMessages((prev) => [...prev, { role: 'error', content: err.message }]);
          toast.error('AskAI failed', { description: err.message });
        },
      },
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button
            size="lg"
            className="fixed bottom-5 right-5 z-40 gap-2 shadow-none"
            aria-label="Open AskAI"
          >
            <CopilotIcon size={18} />
            AskAI
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-lg lg:max-w-xl">
        <SheetHeader className="shrink-0 border-b border-border">
          <SheetTitle className="flex items-center gap-1.5">
            <CopilotIcon size={20} thinking={ask.isPending} /> AskAI
          </SheetTitle>
          <SheetDescription>
            Answers are grounded in the same read-only data the dashboard shows -- routes,
            carriers, methodology, coverage. It won&rsquo;t guess a number.
          </SheetDescription>
        </SheetHeader>

        {STATIC && (
          <div className="mx-4 my-2 shrink-0 border border-border bg-accent px-3 py-2 text-xs text-muted-foreground">
            This is a static demo snapshot with no live API behind it, so AskAI can&rsquo;t run
            here. It works against a locally running backend.
          </div>
        )}

        <ScrollArea className="min-h-0 flex-1 px-4">
          <div className="flex flex-col gap-3 py-2">
            {messages.length === 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">Try asking:</p>
                <div className="flex flex-col gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      disabled={STATIC || ask.isPending}
                      className="border border-border px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <Bubble key={i} message={m} />
            ))}
            {ask.isPending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 bg-accent px-3 py-2 text-sm text-muted-foreground">
                  <CopilotIcon size={16} thinking />
                  Checking the data&hellip;
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {messages.length > 0 && !ask.isPending && (
          <div className="shrink-0 overflow-x-auto border-t border-border px-4 py-2">
            <div className="flex w-max gap-1.5">
              {SUGGESTIONS.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => send(sug)}
                  disabled={STATIC}
                  className="whitespace-nowrap border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>
        )}

        <form
          className="shrink-0 flex items-center gap-2 border-t border-border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={STATIC ? 'Unavailable in static demo' : 'Ask about the index...'}
            disabled={STATIC || ask.isPending}
            aria-label="Ask AskAI a question"
          />
          <Button type="submit" size="icon" disabled={STATIC || ask.isPending || !input.trim()}>
            {ask.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="sr-only">Send</span>
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
