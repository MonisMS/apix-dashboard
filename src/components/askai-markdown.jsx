import { cn } from '@/lib/utils';

/** Markdown for answers: headings, bold, inline code, bullet and numbered
 * lists, horizontal rules, and pipe tables. Tables matter -- the model
 * reaches for one whenever it reports more than two figures, and without
 * support here they rendered as literal rows of "|---|---|". */
export function renderMarkdown(text) {
  const lines = String(text || '').split('\n');
  const blocks = [];
  let listItems = [];
  let ordered = false;

  const inline = (str) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/`([^`]+)`/g, '<code class="rounded-none bg-foreground/10 px-1 py-0.5 font-mono text-[0.9em]">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  const flushList = () => {
    if (!listItems.length) return;
    const Tag = ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag
        key={`list-${blocks.length}`}
        className={cn('ml-4 space-y-0.5', ordered ? 'list-decimal' : 'list-disc')}
      >
        {listItems.map((item, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: inline(item) }} />
        ))}
      </Tag>,
    );
    listItems = [];
  };

  const cells = (row) =>
    row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    // Table: a pipe row followed by a |---|---| separator.
    if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1] ?? '')) {
      flushList();
      const header = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      i--;
      blocks.push(
        // Narrow sheet, wide tables: scroll the table, never the page.
        <div key={`t-${blocks.length}`} className="-mx-1 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border">
                {header.map((h, j) => (
                  <th
                    key={j}
                    className="whitespace-nowrap px-2 py-1 text-left font-semibold"
                    dangerouslySetInnerHTML={{ __html: inline(h) }}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-border/40 last:border-0">
                  {r.map((c, ci) => (
                    <td
                      key={ci}
                      className="whitespace-nowrap px-2 py-1 tabular-nums"
                      dangerouslySetInnerHTML={{ __html: inline(c) }}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (!line.trim()) {
      flushList();
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushList();
      blocks.push(<hr key={`hr-${blocks.length}`} className="border-border/60" />);
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (ordered) flushList();
      ordered = false;
      listItems.push(bullet[1]);
      continue;
    }

    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      if (!ordered) flushList();
      ordered = true;
      listItems.push(numbered[1]);
      continue;
    }

    flushList();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    blocks.push(
      <p
        key={`p-${blocks.length}`}
        className={heading ? 'font-semibold' : undefined}
        dangerouslySetInnerHTML={{ __html: inline(heading ? heading[2] : line) }}
      />,
    );
  }
  flushList();
  return blocks;
}

