/**
 * What a label says, as an expression (core-vis 0.7's `arch-vis:LabelExpression`):
 * text drawn as it is but for its placeholders between braces —
 *
 * - `{name}`: the concept's name;
 * - `{type}`: the name of its type;
 * - `{prefix:local}` or `{<iri>}`: the values of that property of the concept,
 *   a literal as it is, a resource by its name, several joined by ", ";
 * - a path: properties joined by `/`, each followed on from the values before
 *   it, `^` before one to follow it backwards (`{^arch:target/arch:source}`);
 * - `{{` and `}}`: a brace.
 *
 * Its lines are the label's lines. A line whose placeholders all come to
 * nothing is left out, so a line can be there only when the concept has what
 * it shows. A placeholder that cannot be read — an unknown prefix, an empty
 * path — is drawn as it was written, so that the mistake shows, and is listed
 * in {@link ParsedLabelExpression.errors}.
 */

import type { PrefixMap } from '../rdf-engine/interfaces.js';

/** A value as the expression reads it: a literal, or a resource. */
export type LabelValue = { literal: string; language?: string } | { iri: string };

/** Where an expression reads what it shows. */
export interface LabelSource {
  /** The values of `predicate` on `subject`. */
  values(subject: string, predicate: string): LabelValue[];
  /** What has `object` as a value of `predicate`. */
  subjectsOf(object: string, predicate: string): string[];
  /** A resource's name for the presentation context shown: its name for that audience, else its canonical name. */
  nameOf(iri: string): string | undefined;
  /** Its name for the presentation context shown alone (a SKOS-XL name) — `undefined` when it has none, or none is shown. */
  nameForContext?(iri: string): string | undefined;
  /** Its picture for the presentation context shown — else its picture for every audience (core 0.5.0). Not for expressions: for drawing. */
  pictureFor?(iri: string): string | undefined;
  /** The name of a concept's type. */
  typeOf(iri: string): string | undefined;
  /** The prefixes a prefixed name may use: the vocabularies' in use and the model's own. */
  prefixes: PrefixMap;
}

interface Step {
  iri: string;
  inverse: boolean;
}

type Part = { text: string } | { name: true } | { type: true } | { path: Step[] } | { error: string; source: string };

export interface ParsedLabelExpression {
  lines: Part[][];
  /** What could not be read, each with the placeholder as written. */
  errors: string[];
}

/** At most this many values of one placeholder are shown; the rest as "…". */
const MAX_VALUES = 20;

/** Read an expression: its lines, each its text and placeholders. */
export function parseLabelExpression(expression: string, prefixes: PrefixMap): ParsedLabelExpression {
  const errors: string[] = [];
  const lines = expression.replace(/\r\n?/g, '\n').split('\n').map((line) => parseLine(line, prefixes, errors));
  return { lines, errors };
}

function parseLine(line: string, prefixes: PrefixMap, errors: string[]): Part[] {
  const parts: Part[] = [];
  let text = '';
  let i = 0;
  while (i < line.length) {
    const c = line[i]!;
    if (c === '{' && line[i + 1] === '{') {
      text += '{';
      i += 2;
      continue;
    }
    if (c === '}' && line[i + 1] === '}') {
      text += '}';
      i += 2;
      continue;
    }
    if (c === '{') {
      const end = closingBrace(line, i + 1);
      if (end < 0) {
        // Never closed: text, as written.
        text += line.slice(i);
        break;
      }
      if (text) parts.push({ text });
      text = '';
      const source = line.slice(i, end + 1);
      const placeholder = parsePlaceholder(line.slice(i + 1, end).trim(), prefixes);
      if ('error' in placeholder) {
        errors.push(`${source}: ${placeholder.error}`);
        parts.push({ error: placeholder.error, source });
      } else parts.push(placeholder);
      i = end + 1;
      continue;
    }
    text += c;
    i += 1;
  }
  if (text) parts.push({ text });
  return parts;
}

/** Where the placeholder opened before `from` closes: past any `<…>` IRI, which may hold a brace. */
function closingBrace(line: string, from: number): number {
  let inIri = false;
  for (let i = from; i < line.length; i += 1) {
    const c = line[i];
    if (c === '<') inIri = true;
    else if (c === '>') inIri = false;
    else if (c === '}' && !inIri) return i;
  }
  return -1;
}

function parsePlaceholder(content: string, prefixes: PrefixMap): Part | { error: string } {
  if (content === 'name') return { name: true };
  if (content === 'type') return { type: true };
  if (content === '') return { error: 'nothing between the braces' };
  const steps: Step[] = [];
  let rest = content;
  while (rest.length > 0) {
    let inverse = false;
    if (rest.startsWith('^')) {
      inverse = true;
      rest = rest.slice(1).trimStart();
    }
    let token: string;
    if (rest.startsWith('<')) {
      const end = rest.indexOf('>');
      if (end < 0) return { error: 'an IRI not closed with >' };
      token = rest.slice(0, end + 1);
      rest = rest.slice(end + 1).trimStart();
    } else {
      const slash = rest.indexOf('/');
      token = (slash < 0 ? rest : rest.slice(0, slash)).trim();
      rest = slash < 0 ? '' : rest.slice(slash);
    }
    const iri = resolve(token, prefixes);
    if ('error' in iri) return iri;
    steps.push({ iri: iri.iri, inverse });
    if (rest.startsWith('/')) {
      rest = rest.slice(1).trimStart();
      if (rest === '') return { error: 'a path ending with /' };
    } else if (rest !== '') return { error: `"${rest}" after ${token}` };
  }
  return { path: steps };
}

function resolve(token: string, prefixes: PrefixMap): { iri: string } | { error: string } {
  if (token.startsWith('<') && token.endsWith('>')) {
    const iri = token.slice(1, -1).trim();
    return /^[a-z][\w+.-]*:\S+$/i.test(iri) ? { iri } : { error: `${token} is not an IRI` };
  }
  if (token === 'name' || token === 'type') return { error: `${token} stands alone, not in a path` };
  const colon = token.indexOf(':');
  if (colon < 0) return { error: `${token || 'a step'} is neither name, type, a prefixed name nor an <IRI>` };
  const prefix = token.slice(0, colon);
  const local = token.slice(colon + 1);
  const namespace = prefixes[prefix];
  if (namespace === undefined) return { error: `no prefix ${prefix}: is known` };
  if (!/^[^\s<>"{}|^`\\/]*$/.test(local)) return { error: `${token} is not a prefixed name` };
  return { iri: namespace + local };
}

/** What an expression says for `subject`: its lines, those whose placeholders all come to nothing left out. */
export function evaluateLabelExpression(
  parsed: ParsedLabelExpression,
  subject: string,
  source: LabelSource,
  language = 'en',
): string {
  const kept: string[] = [];
  for (const line of parsed.lines) {
    let text = '';
    let placeholders = 0;
    let filled = 0;
    for (const part of line) {
      if ('text' in part) {
        text += part.text;
        continue;
      }
      if ('error' in part) {
        // Drawn as written, so the mistake shows.
        text += part.source;
        continue;
      }
      placeholders += 1;
      const value = 'name' in part ? (source.nameOf(subject) ?? '') : 'type' in part ? (source.typeOf(subject) ?? '') : pathValues(part.path, subject, source, language);
      if (value) filled += 1;
      text += value;
    }
    if (placeholders > 0 && filled === 0) continue;
    kept.push(text);
  }
  return kept.join('\n').trim();
}

/** Read and evaluate in one: what `expression` says for `subject`. */
export function labelFromExpression(expression: string, subject: string, source: LabelSource, language?: string): string {
  return evaluateLabelExpression(parseLabelExpression(expression, source.prefixes), subject, source, language);
}

function pathValues(path: Step[], subject: string, source: LabelSource, language: string): string {
  let frontier: LabelValue[] = [{ iri: subject }];
  for (const step of path) {
    const next: LabelValue[] = [];
    for (const value of frontier) {
      // A literal has no properties to follow.
      if (!('iri' in value)) continue;
      if (step.inverse) next.push(...source.subjectsOf(value.iri, step.iri).map((iri) => ({ iri })));
      else next.push(...source.values(value.iri, step.iri));
    }
    frontier = next;
  }
  // A literal in the language shown, or with none — any, when it has neither.
  const literals = frontier.filter((v): v is { literal: string; language?: string } => 'literal' in v);
  const preferred = literals.filter((v) => !v.language || v.language === language);
  const shownLiterals = preferred.length > 0 ? preferred : literals;
  const shown = [
    ...frontier.filter((v): v is { iri: string } => 'iri' in v).map((v) => source.nameOf(v.iri) ?? localName(v.iri)),
    ...shownLiterals.map((v) => v.literal),
  ].filter((v) => v !== '');
  const unique = [...new Set(shown)];
  return unique.length > MAX_VALUES ? `${unique.slice(0, MAX_VALUES).join(', ')}, …` : unique.join(', ');
}

function localName(iri: string): string {
  return iri.split(/[#/]/).pop() || iri;
}
