/**
 * Snapshot lines taken apart: the canonical N-Triples lines {@link snapshotOf}
 * writes (`<s> <p> o .`), read without a parser — the merge (`model-merge.ts`)
 * and the diff by element (`model-diff.ts`) read hundreds of thousands of them.
 *
 * Terms stay as N-Triples text (`<iri>`, `_:b`, a literal with its quotes), so
 * they compare as the lines do; a predicate comes back as its IRI.
 */

/** A line taken apart. */
export interface Line {
  s: string;
  /** The predicate's IRI. */
  p: string;
  o: string;
  /** A literal's language, lower case; `''` for none. */
  lang: string;
  /** The IRIs and blank nodes the object names — itself, or those inside a triple term. */
  refs: readonly string[];
}

/** Take an N-Triples line apart (as `snapshotOf` writes them: `<s> <p> o .`). */
export function parseLine(line: string): Line {
  const i1 = line.indexOf(' ');
  const i2 = line.indexOf(' ', i1 + 1);
  const s = line.slice(0, i1);
  const p = line.slice(i1 + 2, i2 - 1);
  const o = line.slice(i2 + 1, line.endsWith(' .') ? line.length - 2 : line.length);
  if (o.startsWith('"')) {
    const tail = o.slice(o.lastIndexOf('"') + 1);
    return { s, p, o, lang: tail.startsWith('@') ? tail.slice(1).toLowerCase() : '', refs: [] };
  }
  return { s, p, o, lang: '', refs: o.startsWith('<<') ? nodesIn(o) : [o] };
}

/** The IRIs and blank nodes in a triple term, its literals' contents and datatypes skipped. */
export function nodesIn(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('<<(', i)) {
      i += 2;
    } else if (text[i] === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      if (text.startsWith('^^<', i + 1)) i = text.indexOf('>', i + 3);
    } else if (text[i] === '<') {
      const end = text.indexOf('>', i);
      out.push(text.slice(i, end + 1));
      i = end;
    } else if (text.startsWith('_:', i)) {
      let end = i + 2;
      while (end < text.length && !/[\s)]/.test(text[end])) end++;
      out.push(text.slice(i, end));
      i = end - 1;
    }
  }
  return out;
}

/** A line's subject, as N-Triples. */
export function subjectOf(line: string): string {
  return line.slice(0, line.indexOf(' '));
}

/** A line's predicate, as an IRI. */
export function predicateOf(line: string): string {
  const i1 = line.indexOf(' ');
  return line.slice(i1 + 2, line.indexOf(' ', i1 + 1) - 1);
}

/** `<iri>` → the IRI; a blank node stays `_:label`. */
export function iriOf(term: string): string {
  return term.startsWith('<') ? term.slice(1, -1) : term;
}

/** An IRI (or `_:label`) as an N-Triples term. */
export function termText(iriOrBlank: string): string {
  return iriOrBlank.startsWith('_:') ? iriOrBlank : `<${iriOrBlank}>`;
}

/** A literal's text, unescaped; `undefined` for a term that is not a literal. */
export function literalValue(term: string): string | undefined {
  if (!term.startsWith('"')) return undefined;
  const body = term.slice(1, term.lastIndexOf('"'));
  return body.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_m, c: string) => {
    if (c.length > 1) return String.fromCodePoint(parseInt(c.slice(1), 16));
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[c] ?? c;
  });
}
