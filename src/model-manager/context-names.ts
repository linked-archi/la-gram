/**
 * Names for an audience (core 0.5.0): what an element is called in one
 * presentation context, beside its canonical `skos:prefLabel`.
 *
 * A name is a SKOS-XL label — `skosxl:Label`, its text `skosxl:literalForm`,
 * language tagged, `arch:inPresentationContext` the context — given to the
 * element as `skosxl:altLabel`, never `skosxl:prefLabel` (that would be a
 * second canonical name). Its literal form is also written as the element's
 * plain `skos:altLabel`, so that tools reading plain SKOS find it. The label is
 * named after the element and the context (`{element}-name-{hash}`), so that
 * a merge can match it; an element has one name per context and language.
 */

import { DataFactory } from 'n3';
import type { NamedNode, Quad, Term } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { shortHash } from './short-hash.js';
import { T } from './vocabulary.js';

const { namedNode, literal, quad } = DataFactory;

/** One name an element has for one presentation context. */
export interface ContextName {
  context: string;
  name: string;
  /** The name's language; '' for none. */
  language: string;
  /** The SKOS-XL label that holds it. */
  label: string;
}

/** Every name `iri` has for a presentation context. */
export function contextNamesOf(store: RdfStore, iri: string): ContextName[] {
  const names: ContextName[] = [];
  for (const link of store.getQuads(namedNode(iri) as never, T.skosxlAltLabel as never)) {
    const label = link.object;
    if (label.termType === 'Literal') continue;
    const context = store.getQuads(label as never, T.inPresentationContext as never)[0]?.object.value;
    if (!context) continue;
    for (const form of store.getQuads(label as never, T.skosxlLiteralForm as never)) {
      if (form.object.termType !== 'Literal') continue;
      names.push({ context, name: form.object.value, language: (form.object as { language?: string }).language ?? '', label: label.value });
    }
  }
  return names;
}

/** `iri`'s name for `context`: in `language`, else in none, else in any — `undefined` when it has none. */
export function contextNameOf(store: RdfStore, iri: string, context: string | undefined, language = 'en'): string | undefined {
  if (!context) return undefined;
  const names = contextNamesOf(store, iri).filter((n) => n.context === context);
  return (names.find((n) => n.language === language) ?? names.find((n) => n.language === '') ?? names[0])?.name;
}

/** The IRI of `iri`'s name for `context` in `language`. */
export function contextNameIri(iri: string, context: string, language: string): string {
  return `${iri}-name-${shortHash(context)}${language && language !== 'en' ? `-${language}` : ''}`;
}

/**
 * What changes to give `iri` the name `name` for `context` in `language` —
 * or, `null` or empty, to take it away: the label it has for that context and
 * language goes, with its plain `skos:altLabel` unless another of its names
 * has that text too.
 */
export function contextNameChange(
  store: RdfStore,
  iri: string,
  context: string,
  name: string | null,
  language = 'en',
): { remove: Quad[]; add: Quad[] } {
  const element = namedNode(iri);
  const remove: Quad[] = [];
  const names = contextNamesOf(store, iri);
  const replaced = names.filter((n) => n.context === context && n.language === language);
  const kept = names.filter((n) => !replaced.includes(n));
  for (const old of replaced) {
    const label = namedNode(old.label);
    remove.push(...(store.getQuads(element as never, T.skosxlAltLabel as never, label as never) as Quad[]));
    remove.push(...(store.getQuads(label as never) as Quad[]));
    // Its plain form goes too, unless another of its names says the same.
    if (!kept.some((n) => n.name === old.name && n.language === old.language)) {
      remove.push(...(store.getQuads(element as never, T.altLabel as never, literal(old.name, old.language || undefined) as never) as Quad[]));
    }
  }
  const text = name?.trim() ?? '';
  if (text === '') return { remove, add: [] };
  const label = namedNode(contextNameIri(iri, context, language));
  const form = literal(text, language || undefined);
  const add: Quad[] = [
    quad(element, T.skosxlAltLabel as NamedNode, label) as Quad,
    quad(label, T.rdfType as NamedNode, T.skosxlLabel as Term as NamedNode) as Quad,
    quad(label, T.skosxlLiteralForm as NamedNode, form) as Quad,
    quad(label, T.inPresentationContext as NamedNode, namedNode(context)) as Quad,
    quad(element, T.altLabel as NamedNode, form) as Quad,
  ];
  return { remove, add };
}
