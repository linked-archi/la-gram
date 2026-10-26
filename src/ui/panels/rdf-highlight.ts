/**
 * Syntax highlighting for the RDF panel.
 *
 * Turns serialized RDF into HTML: every token wrapped in a `<span class="rdf-…">`,
 * and — for the line-oriented formats (Turtle, TriG, N-Triples, N-Quads) — every
 * subject's statements wrapped in a `<div class="rdf-block" data-subject="…">`,
 * so the panel can highlight and scroll to the selected concept and turn a click
 * on a block into a selection.
 *
 * Why a hand-written tokenizer rather than an editor component: the panel is
 * read-only, re-renders on every model change, and a model of a few hundred
 * elements is half a megabyte of Turtle. Building one HTML string and assigning
 * it once is an order of magnitude cheaper than an editor's incremental
 * document model, and escaping is the only correctness concern.
 *
 * Block detection follows how n3's writer lays statements out: a subject starts
 * an unindented line, its further predicates are indented, and in TriG a graph
 * opens with `<g> {` and closes with `}`. Consecutive N-Triples lines with the
 * same subject are one block.
 */

/** Serializations the panel can show. */
export type RdfTextFormat = 'turtle' | 'trig' | 'n-triples' | 'n-quads' | 'json-ld' | 'rdf-xml';

/** Token classes, also the CSS class suffixes. */
export type RdfTokenType =
  | 'comment'
  | 'directive'
  | 'iri'
  | 'pname'
  | 'bnode'
  | 'string'
  | 'lang'
  | 'datatype'
  | 'number'
  | 'keyword'
  | 'punct'
  | 'ws'
  | 'text';

/** One token. */
export interface RdfToken {
  type: RdfTokenType;
  text: string;
}

/** Escape text for HTML (content and attribute values). */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

const PNAME = /^[A-Za-z][\w.-]*:[^\s;,.()[\]{}"'<>]*(?:\.[^\s;,.()[\]{}"'<>]+)*|^:[^\s;,.()[\]{}"'<>]*/;

/** Tokenize one line of a Turtle-family document. */
export function tokenizeLine(line: string): RdfToken[] {
  const tokens: RdfToken[] = [];
  let i = 0;
  const push = (type: RdfTokenType, text: string) => {
    tokens.push({ type, text });
    i += text.length;
  };
  while (i < line.length) {
    const rest = line.slice(i);
    const c = line[i];
    const ws = /^\s+/.exec(rest);
    if (ws) {
      push('ws', ws[0]);
      continue;
    }
    if (c === '#') {
      push('comment', rest);
      continue;
    }
    if (c === '@') {
      const directive = /^@(prefix|base)\b/.exec(rest);
      const lang = /^@[A-Za-z]+(?:-[A-Za-z0-9]+)*/.exec(rest);
      if (directive) push('directive', directive[0]);
      else if (lang) push('lang', lang[0]);
      else push('text', c);
      continue;
    }
    if (c === '<') {
      const end = line.indexOf('>', i);
      push('iri', end === -1 ? rest : line.slice(i, end + 1));
      continue;
    }
    if (c === '"' || c === "'") {
      // Long strings ("""…""") are kept on one line by the writers we use.
      const quote = rest.startsWith(c.repeat(3)) ? c.repeat(3) : c;
      let j = i + quote.length;
      while (j < line.length && !line.startsWith(quote, j)) j += line[j] === '\\' ? 2 : 1;
      push('string', line.slice(i, Math.min(line.length, j + quote.length)));
      if (line.startsWith('^^', i)) {
        push('datatype', '^^');
      }
      continue;
    }
    if (rest.startsWith('^^')) {
      push('datatype', '^^');
      continue;
    }
    if (rest.startsWith('_:')) {
      push('bnode', /^_:[^\s;,.()[\]{}]+/.exec(rest)?.[0] ?? '_:');
      continue;
    }
    const number = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?(?![\w:])/.exec(rest);
    if (number) {
      push('number', number[0]);
      continue;
    }
    if (/^(a|true|false|PREFIX|BASE|GRAPH)(?![\w:-])/.test(rest)) {
      push('keyword', /^\w+/.exec(rest)![0]);
      continue;
    }
    const pname = PNAME.exec(rest);
    if (pname && pname[0].length > 0) {
      push('pname', pname[0]);
      continue;
    }
    if ('.;,()[]{}'.includes(c)) {
      push('punct', c);
      continue;
    }
    push('text', c);
  }
  return tokens;
}

/** HTML for a line's tokens. */
function lineHtml(line: string): string {
  return tokenizeLine(line)
    .map((t) => (t.type === 'ws' ? t.text : `<span class="rdf-${t.type}">${escapeHtml(t.text)}</span>`))
    .join('');
}

/** `@prefix p: <ns>.` / `PREFIX p: <ns>` declarations of a document. */
export function readPrefixes(text: string): Map<string, string> {
  const prefixes = new Map<string, string>();
  const re = /^\s*(?:@prefix|PREFIX)\s+([\w.-]*):\s*<([^>]*)>/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) prefixes.set(m[1], m[2]);
  return prefixes;
}

/** The subject IRI a statement line opens with, expanded, or `undefined`. */
export function subjectOf(line: string, prefixes: Map<string, string>): string | undefined {
  if (/^\s/.test(line) || line.length === 0) return undefined;
  if (/^(@prefix|@base|PREFIX|BASE)\b/i.test(line) || line.startsWith('}') || line.startsWith('#')) return undefined;
  // A TriG graph opening, `<g> {`, is not a subject.
  if (/\{\s*$/.test(line)) return undefined;
  const iri = /^<([^>]*)>/.exec(line);
  if (iri) return iri[1];
  const bnode = /^(_:[^\s;,.]+)/.exec(line);
  if (bnode) return bnode[1];
  const pname = /^([\w.-]*):([^\s;,()[\]{}"'<>]*)/.exec(line);
  if (pname && prefixes.has(pname[1])) return prefixes.get(pname[1]) + pname[2].replace(/\.$/, '');
  return undefined;
}

/** Above this many characters, text is escaped but not tokenized — and the RDF panel does not show a whole model. */
export const HIGHLIGHT_LIMIT = 1_500_000;

/**
 * Highlight a serialized model as HTML.
 *
 * @param maxHighlight Above this many characters the text is escaped but not
 *   tokenized (blocks are still marked) — a safety valve for very large models.
 */
export function highlightRdf(text: string, format: RdfTextFormat, maxHighlight = HIGHLIGHT_LIMIT): string {
  if (format === 'json-ld' || format === 'rdf-xml') return highlightStructured(text, format, maxHighlight);

  const prefixes = readPrefixes(text);
  const highlight = text.length <= maxHighlight;
  const lines = text.split('\n');
  const out: string[] = [];
  let open: string | undefined;

  const close = () => {
    if (open !== undefined) out.push('</div>');
    open = undefined;
  };

  for (const line of lines) {
    const subject = subjectOf(line, prefixes);
    const continuation = open !== undefined && /^\s/.test(line) && line.trim().length > 0;
    if (subject !== undefined) {
      // N-Triples: consecutive lines of one subject stay one block.
      if (subject !== open) {
        close();
        out.push(`<div class="rdf-block" data-subject="${escapeHtml(subject)}">`);
        open = subject;
      }
    } else if (!continuation) {
      close();
    }
    out.push((highlight ? lineHtml(line) : escapeHtml(line)) + '\n');
  }
  close();
  return out.join('');
}

/** JSON-LD and RDF/XML: token colouring only, no blocks. */
function highlightStructured(text: string, format: 'json-ld' | 'rdf-xml', maxHighlight: number): string {
  if (text.length > maxHighlight) return escapeHtml(text);
  if (format === 'json-ld') {
    return escapeHtml(text).replace(
      /(&quot;(?:[^&\\]|\\.|&(?!quot;))*&quot;)(\s*:)?/g,
      (_m, str: string, colon: string | undefined) =>
        colon ? `<span class="rdf-pname">${str}</span>${colon}` : `<span class="rdf-string">${str}</span>`,
    );
  }
  return escapeHtml(text)
    .replace(/(&lt;\/?)([\w:.-]+)/g, '$1<span class="rdf-pname">$2</span>')
    .replace(/([\w:.-]+)=(&quot;.*?&quot;)/g, '<span class="rdf-keyword">$1</span>=<span class="rdf-string">$2</span>');
}
