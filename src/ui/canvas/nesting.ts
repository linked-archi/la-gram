/**
 * What nesting one element inside another may stand for.
 *
 * Nesting is drawing: a shape inside another (`arch-vis:inNode`) says nothing
 * by itself. A notation says which relationships nesting may draw instead of a
 * line, and which end goes inside (`arch-vis:nestedEnd`): ArchiMate's part
 * inside its whole (composition — the target inside), its specialized element
 * inside the generic one (the source inside), realization either way; C4's
 * container inside its software system. Dropping an element into another
 * offers those the metamodel permits between the two, and that the model does
 * not already have — or none at all.
 */

import type { RelationshipTypeInfo } from '../../metamodel-manager/interfaces.js';
import type { RelationshipInfo } from '../../model-manager/interfaces.js';
import { assetUrl } from '../../metamodel-manager/bundled-assets.js';
import { iconHref } from './notation-shapes.js';

/** An element on the canvas: its IRI and its type. */
export interface NestedEnd {
  iri: string;
  typeIri: string;
}

/** A relationship nesting `inner` inside `outer` may stand for. */
export interface NestingOffer {
  /** The relationship type. */
  type: RelationshipTypeInfo;
  sourceIri: string;
  targetIri: string;
  /** Which end of the relationship is the element drawn inside. */
  innerEnd: 'source' | 'target';
}

/**
 * The relationships nesting `inner` inside `outer` may stand for, ranked as the
 * metamodel ranks them: those with the inner element as their target first.
 *
 * @param relationshipTypes The palette's relationship types, carrying their notation.
 * @param permitted The relationship types the metamodel permits from one type to another.
 * @param existing The relationships already between the two, in the model.
 */
export function nestingOffers(
  outer: NestedEnd,
  inner: NestedEnd,
  relationshipTypes: readonly RelationshipTypeInfo[],
  permitted: (sourceTypeIri: string, targetTypeIri: string) => readonly RelationshipTypeInfo[],
  existing: readonly RelationshipInfo[] = [],
): NestingOffer[] {
  const nestedEnds = new Map(relationshipTypes.map((t) => [t.iri, t.relationshipStyle?.nestedEnds ?? []]));
  const has = (typeIri: string, sourceIri: string, targetIri: string) =>
    existing.some((r) => r.classIri === typeIri && r.sourceIri === sourceIri && r.targetIri === targetIri);
  const offers: NestingOffer[] = [];
  const direction = (source: NestedEnd, target: NestedEnd, innerEnd: 'source' | 'target') => {
    for (const type of permitted(source.typeIri, target.typeIri)) {
      if (!nestedEnds.get(type.iri)?.includes(innerEnd)) continue;
      if (has(type.iri, source.iri, target.iri)) continue;
      offers.push({ type, sourceIri: source.iri, targetIri: target.iri, innerEnd });
    }
  };
  direction(outer, inner, 'target');
  direction(inner, outer, 'source');
  return offers;
}

/**
 * Whether the two are already related by a relationship nesting may draw —
 * then the nesting shows it, and there is nothing to offer.
 */
export function nestingShownBy(
  outer: NestedEnd,
  inner: NestedEnd,
  relationshipTypes: readonly RelationshipTypeInfo[],
  existing: readonly RelationshipInfo[],
): boolean {
  const nestedEnds = new Map(relationshipTypes.map((t) => [t.iri, t.relationshipStyle?.nestedEnds ?? []]));
  return existing.some(
    (r) =>
      (r.sourceIri === outer.iri && r.targetIri === inner.iri && nestedEnds.get(r.classIri)?.includes('target')) ||
      (r.sourceIri === inner.iri && r.targetIri === outer.iri && nestedEnds.get(r.classIri)?.includes('source')),
  );
}

/** Popup menu id of the "which relationship does this nesting stand for?" menu. */
export const NEST_MENU_ID = 'la-nest-relationship';

/** What the menu is for: set by the canvas as it opens it. */
export interface PendingNesting {
  outerLabel: string;
  innerLabel: string;
  offers: NestingOffer[];
}

/**
 * The menu after a drop into a container: the relationships the nesting may
 * stand for, best first, and "None" — nesting can also be just drawing.
 */
export class RdfNestMenuProvider {
  pending: PendingNesting | undefined;

  /**
   * @param choose Called with the relationship picked, or `undefined` for none.
   * @param iconFor The icon of a relationship type, as the palette publishes it.
   */
  constructor(
    private readonly choose: (offer: NestingOffer | undefined) => void,
    private readonly iconFor?: (relationshipTypeIri: string) => string | undefined,
  ) {}

  getPopupMenuEntries(_target: unknown): Record<string, unknown> {
    const pending = this.pending;
    if (!pending) return {};
    const entries: Record<string, unknown> = {};
    pending.offers.forEach((offer, index) => {
      // Source first: the container, unless the nested element is the source.
      const [from, to] =
        offer.innerEnd === 'target' ? [pending.outerLabel, pending.innerLabel] : [pending.innerLabel, pending.outerLabel];
      // The palette's first, as the append menu: what the manager reads off the class may not load.
      const imageUrl = iconHref(this.iconFor?.(offer.type.iri) ?? offer.type.iconUrl, assetUrl) ?? undefined;
      entries[`la-nest-${index}`] = {
        label: offer.type.label,
        className: 'la-nest-entry',
        ...(imageUrl ? { imageUrl } : {}),
        title: offer.type.definition ?? offer.type.label,
        description: `${from} → ${to}`,
        action: () => this.choose(offer),
      };
    });
    entries['la-nest-none'] = {
      label: 'None',
      className: 'la-nest-entry',
      title: 'Only drawn inside: no relationship in the model',
      description: 'only drawn inside',
      action: () => this.choose(undefined),
    };
    return entries;
  }
}
