/**
 * The diff by element (`model-diff.ts`) in words: a concept's name and type, a
 * value, a shape's change — one wording for the History tab, a merge request's
 * description, and what CI posts on one.
 *
 * Names come from the versions compared ({@link ModelDiff.about}), so a concept
 * removed is still named; types and properties are named by the caller, who has
 * the metamodels.
 */

import type { ConceptChange, ModelDiff, ShapeChange, ValueChange } from './model-diff.js';
import { literalValue } from './snapshot-lines.js';
import { localName } from './vocabulary.js';

/** What the words need from the metamodels. */
export interface DiffWords {
  /** A class's name: `Application Component`. */
  typeName(iri: string): string;
  /** A property's name: `Name`, `Target`. */
  propertyName(iri: string): string;
}

const CORE = 'https://meta.linked.archi/core#';
const NUMBER_TYPES = new Set(['double', 'decimal', 'float', 'integer', 'int', 'long', 'short', 'boolean'].map((t) => `http://www.w3.org/2001/XMLSchema#${t}`));

/** The type a concept is shown with: its first outside the core vocabulary, else its first. */
export function shownType(diff: ModelDiff, iri: string): string | undefined {
  const types = diff.about[iri]?.types ?? [];
  return types.find((t) => !t.startsWith(CORE)) ?? types[0];
}

/** A concept's name; one without — a relationship, mostly — by its type; else its IRI's last part. */
export function conceptName(diff: ModelDiff, iri: string, words: DiffWords): string {
  const name = diff.about[iri]?.name;
  if (name) return name;
  const type = shownType(diff, iri);
  return type ? words.typeName(type) : localName(iri) || iri;
}

/** A value: a concept by its name, text in quotes with its language (unless `language` is false), a number as it is. */
export function termLabel(diff: ModelDiff, term: string, words: DiffWords, language = true): string {
  if (term.startsWith('<<')) return term;
  if (term.startsWith('<')) return conceptName(diff, term.slice(1, -1), words);
  if (term.startsWith('_:')) return term;
  const text = literalValue(term) ?? term;
  const tail = term.slice(term.lastIndexOf('"') + 1);
  if (tail.startsWith('@')) return language ? `“${text}” (${tail.slice(1)})` : `“${text}”`;
  if (tail.startsWith('^^<') && NUMBER_TYPES.has(tail.slice(3, -1))) return text;
  return `“${text}”`;
}

/** A relationship's ends: `Billing → ERP`. */
export function endsText(diff: ModelDiff, change: ConceptChange, words: DiffWords): string | undefined {
  if (!change.ends) return undefined;
  const end = (iri: string | undefined) => (iri ? conceptName(diff, iri, words) : '?');
  return `${end(change.ends.source)} → ${end(change.ends.target)}`;
}

/** A single value's change: `Name (en): “Billing” → “Invoicing”`; for a concept added, its value only. */
export function valueText(diff: ModelDiff, value: ValueChange, words: DiffWords, added = false): string {
  const name = `${words.propertyName(value.predicate)}${value.language ? ` (${value.language})` : ''}`;
  // A value per language: its language is said once, with the property.
  const side = (terms: string[]) =>
    terms.length === 0 ? '—' : terms.map((t) => termLabel(diff, t, words, value.language === undefined)).join(', ');
  return added && value.from.length === 0 ? `${name}: ${side(value.to)}` : `${name}: ${side(value.from)} → ${side(value.to)}`;
}

/** A shape's change: `placed ERP`, `moved and resized Billing`, `removed CRM`. */
export function shapeText(diff: ModelDiff, shape: ShapeChange, words: DiffWords): string {
  const what = shape.shows ? conceptName(diff, shape.shows, words) : shape.kind === 'link' ? 'a line' : 'a shape';
  if (shape.status === 'added') return `${shape.kind === 'link' ? 'drew' : 'placed'} ${what}`;
  if (shape.status === 'removed') return `removed ${what}`;
  const verbs = [
    shape.moved && 'moved',
    shape.resized && 'resized',
    shape.rerouted && 'rerouted',
    shape.reconnected && 'reconnected',
    shape.restyled && 'restyled',
  ].filter((v): v is string => Boolean(v));
  return `${joined(verbs.length > 0 ? verbs : ['changed'])} ${what}`;
}

/** What a concept changed, a line each: values, values added and removed, a view's shapes and what it shows. */
export function detailLines(diff: ModelDiff, change: ConceptChange, words: DiffWords): Array<{ kind: 'value' | 'added' | 'removed' | 'shape'; text: string }> {
  if (change.status === 'removed') return [];
  const added = change.status === 'added';
  const value = (v: { predicate: string; object: string }) => `${words.propertyName(v.predicate)}: ${termLabel(diff, v.object, words)}`;
  return [
    ...change.values.map((v) => ({ kind: 'value' as const, text: valueText(diff, v, words, added) })),
    ...change.added.map((v) => ({ kind: 'added' as const, text: value(v) })),
    ...change.removed.map((v) => ({ kind: 'removed' as const, text: value(v) })),
    ...change.shapes.map((s) => ({ kind: 'shape' as const, text: shapeText(diff, s, words) })),
    ...change.shows.added.map((iri) => ({ kind: 'added' as const, text: `shows ${conceptName(diff, iri, words)}` })),
    ...change.shows.removed.map((iri) => ({ kind: 'removed' as const, text: `no longer shows ${conceptName(diff, iri, words)}` })),
  ];
}

/** A time as the Markdown gives it, the same wherever it is written: `2026-11-20 16:40 UTC`. */
export function utcMinute(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** Who made a change and when, as the later version records it: `by Ada Lovelace, 2026-11-20 16:40 UTC`. */
export function editText(change: ConceptChange, when: (iso: string) => string = utcMinute): string | undefined {
  const edit = change.edit;
  if (!edit?.by && !edit?.at) return undefined;
  return [edit.by ? `by ${edit.by}` : '', edit.at ? when(edit.at) : ''].filter(Boolean).join(', ');
}

/** `1 added · 1 removed · 5 changed`, leaving out the noughts; `No changes` for none. */
export function countsText(diff: ModelDiff): string {
  const parts = (['added', 'removed', 'changed'] as const).filter((s) => diff.counts[s] > 0).map((s) => `${diff.counts[s]} ${s}`);
  return parts.length > 0 ? parts.join(' · ') : 'No changes';
}

/**
 * The diff as Markdown: the counts, then a line per concept with what changed
 * under it — at most `limit` concepts, the rest counted.
 */
export function markdownOfDiff(diff: ModelDiff, words: DiffWords, limit = 100): string {
  if (diff.changes.length === 0) return '_No changes to the model._';
  const out = [`**Changes by element:** ${countsText(diff)}`, ''];
  const sign = { added: '➕', removed: '➖', changed: '✏️' } as const;
  const escape = (text: string) => text.replace(/([\\`*_[\]<>|])/g, '\\$1');
  for (const change of diff.changes.slice(0, limit)) {
    const type = shownType(diff, change.subject);
    const ends = endsText(diff, change, words);
    const edit = editText(change);
    const head = [
      `${sign[change.status]} **${escape(conceptName(diff, change.subject, words))}**`,
      type && diff.about[change.subject]?.name ? ` _${escape(words.typeName(type))}_` : '',
      ends ? ` ${escape(ends)}` : '',
      change.status === 'changed' ? (edit ? ' — changed' : '') : ` — ${change.status}`,
      edit ? ` ${escape(edit)}` : '',
    ].join('');
    out.push(`- ${head}`);
    for (const line of detailLines(diff, change, words)) {
      const mark = line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '';
      out.push(`  - ${mark}${escape(line.text)}`);
    }
  }
  const more = diff.changes.length - limit;
  if (more > 0) out.push('', `_… and ${more} more._`);
  return out.join('\n');
}

function joined(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}
