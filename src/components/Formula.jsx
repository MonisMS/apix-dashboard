'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * Renders the engine's ASCII notation as real typeset maths.
 *
 * The formulas arrive from the API as plain strings -- "I_t = GM_i( p_t^i /
 * p_{t-1}^i ) * I_{t-1}" -- and were previously dumped into a <Code> block
 * exactly like that. Read as flat text, "p_t^i" genuinely looks like it says
 * "t" over "i", which is the opposite of what it means: p is the price of
 * item i at time t.
 *
 * So the subscripts and superscripts are rendered as subscripts and
 * superscripts, "sum" becomes an actual sigma, and the raw string stays
 * available behind a copy button for anyone who wants to paste it.
 */

/** Split "p_{t-1}^i" into its base, subscript and superscript. */
function tokenise(src) {
  const out = [];
  let i = 0;
  const readGroup = () => {
    if (src[i] === '{') {
      const end = src.indexOf('}', i);
      const val = src.slice(i + 1, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end + 1;
      return val;
    }
    const m = /^[A-Za-z0-9+-]+/.exec(src.slice(i));
    if (!m) return '';
    i += m[0].length;
    return m[0];
  };

  while (i < src.length) {
    const ident = /^[A-Za-z]+/.exec(src.slice(i));
    if (ident) {
      i += ident[0].length;
      let base = ident[0];
      if (base === 'sum') base = 'Σ';
      if (base === 'prod') base = '∏';
      let sub = '';
      let sup = '';
      if (src[i] === '_') { i += 1; sub = readGroup(); }
      if (src[i] === '^') { i += 1; sup = readGroup(); }
      out.push({ base, sub, sup });
      continue;
    }
    // Everything else -- operators, brackets, spaces -- passes through, with
    // the ASCII star shown as a proper multiplication dot.
    out.push({ text: src[i] === '*' ? '·' : src[i] });
    i += 1;
  }
  return out;
}

export function Formula({ children, source, className }) {
  const raw = String(children ?? '');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-3 border border-border bg-muted/40 px-3 py-2.5">
        <span className="font-serif text-[15px] leading-relaxed" translate="no">
          {tokenise(raw).map((t, n) =>
            t.text !== undefined ? (
              <span key={n}>{t.text}</span>
            ) : (
              <span key={n} className="whitespace-nowrap">
                <span className="italic">{t.base}</span>
                {t.sub && <sub className="text-[0.7em] not-italic opacity-80">{t.sub}</sub>}
                {t.sup && <sup className="text-[0.7em] not-italic opacity-80">{t.sup}</sup>}
              </span>
            ),
          )}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Formula copied' : 'Copy this formula'}
          className="shrink-0 border border-border px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied
            ? <Check className="h-3.5 w-3.5" aria-hidden="true" />
            : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
      </div>
      {source && <p className="mt-1.5 text-xs text-muted-foreground">{source}</p>}
    </div>
  );
}
