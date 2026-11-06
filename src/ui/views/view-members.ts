/**
 * What a catalog lists and a matrix indexes: the elements the view presents.
 *
 * Membership is `arch:inView` (core 0.4, DD-30) — "a Catalog that lists it, a
 * Matrix that indexes it" — the same fact a diagram writes beside its geometry.
 * A catalog or matrix has no geometry, so membership is all it has: these read
 * it, and the "Add" picker offers the model's element types to add from.
 *
 * Elements only: a member with `arch:source` is a relationship (a matrix shows
 * relationships in its cells, between its elements), and views and the model
 * resource are not elements.
 */

import { html, nothing, type TemplateResult } from 'lit';
import type { Quad } from '@rdfjs/types';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

const RDF_TYPE = NAMESPACES.rdf + 'type';
const SKOS_PREF_LABEL = NAMESPACES.skos + 'prefLabel';
const ARCH = NAMESPACES.arch;
const IN_VIEW = ARCH + 'inView';
const IN_MODEL = ARCH + 'inModel';
const SOURCE = ARCH + 'source';
const NOT_ELEMENTS = new Set(['Model', 'View', 'Diagram', 'Catalog', 'Matrix', 'QualifiedRelationship'].map((c) => ARCH + c));

/** An element a view presents. */
export interface ViewMember {
  iri: string;
  /** Its type — the first one not a core structural class. */
  typeIri: string;
  label: string;
}

/** An element type of the model, with how many elements it has and how many the view already holds. */
export interface AddableType {
  typeIri: string;
  count: number;
  inView: number;
}

/** The last segment of an IRI, for labels. */
function localName(iri: string): string {
  return iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1);
}

/** Every element of the model (`arch:inModel`, not a relationship, view or the model), with its type and label. */
function modelElements(quads: Quad[]): Map<string, ViewMember> {
  const inModel = new Set<string>();
  const relationships = new Set<string>();
  const types = new Map<string, string[]>();
  const labels = new Map<string, string>();
  for (const q of quads) {
    if (q.graph.termType !== 'DefaultGraph' || q.subject.termType !== 'NamedNode') continue;
    const s = q.subject.value;
    const p = q.predicate.value;
    if (p === IN_MODEL) inModel.add(s);
    else if (p === SOURCE) relationships.add(s);
    else if (p === RDF_TYPE) types.set(s, [...(types.get(s) ?? []), q.object.value]);
    else if (p === SKOS_PREF_LABEL && !labels.has(s)) labels.set(s, q.object.value);
  }
  const elements = new Map<string, ViewMember>();
  for (const iri of inModel) {
    if (relationships.has(iri)) continue;
    const all = types.get(iri) ?? [];
    if (all.some((t) => NOT_ELEMENTS.has(t))) continue;
    const typeIri = all.find((t) => !t.startsWith(ARCH)) ?? all[0];
    if (!typeIri) continue;
    elements.set(iri, { iri, typeIri, label: labels.get(iri) ?? localName(iri) });
  }
  return elements;
}

/** The elements `viewIri` presents, by label. */
export function viewMembers(quads: Quad[], viewIri: string): ViewMember[] {
  const elements = modelElements(quads);
  const members: ViewMember[] = [];
  for (const q of quads) {
    if (q.predicate.value !== IN_VIEW || q.object.value !== viewIri) continue;
    const element = elements.get(q.subject.value);
    if (element) members.push(element);
  }
  return members.sort((a, b) => a.label.localeCompare(b.label));
}

/** The model's element types, each with its element count and how many of them the view holds. */
export function addableTypes(quads: Quad[], viewIri: string): AddableType[] {
  const members = new Set(viewMembers(quads, viewIri).map((m) => m.iri));
  const byType = new Map<string, AddableType>();
  for (const element of modelElements(quads).values()) {
    const entry = byType.get(element.typeIri) ?? { typeIri: element.typeIri, count: 0, inView: 0 };
    entry.count += 1;
    if (members.has(element.iri)) entry.inView += 1;
    byType.set(element.typeIri, entry);
  }
  return [...byType.values()];
}

/** The model's elements of a type, by IRI — what "Add all of a type" adds. */
export function elementsOfType(quads: Quad[], typeIri: string): string[] {
  return [...modelElements(quads).values()].filter((e) => e.typeIri === typeIri).map((e) => e.iri);
}

/**
 * The "Add" picker both views show: the model's element types not yet wholly in
 * the view, each with how many it would add; choosing one adds them all.
 */
export function renderAddPicker(
  types: AddableType[],
  typeLabel: (typeIri: string) => string,
  onAdd: (typeIri: string) => void,
): TemplateResult | typeof nothing {
  const open = types
    .filter((t) => t.inView < t.count)
    .sort((a, b) => typeLabel(a.typeIri).localeCompare(typeLabel(b.typeIri)));
  if (open.length === 0) return nothing;
  return html`<label class="view-add">
    Add
    <select
      aria-label="Add the elements of a type"
      @change=${(e: Event) => {
        const select = e.target as HTMLSelectElement;
        if (select.value) onAdd(select.value);
        select.value = '';
      }}
    >
      <option value="">elements of a type…</option>
      ${open.map(
        (t) => html`<option value=${t.typeIri}>${typeLabel(t.typeIri)} (${t.count - t.inView})</option>`,
      )}
    </select>
  </label>`;
}
