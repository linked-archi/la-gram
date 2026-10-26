/**
 * The relationships two selected elements may have — what a two-element
 * selection's context pad offers under "Connect these two…".
 *
 * Both directions, each under a header naming it ("Order Desk → Order
 * Handling"), each ranked as `RelationshipManager.getValidRelationships` ranks a
 * pair, each saying why in a few words (`preferenceNotes`: "proposed first",
 * "drawn in the metamodel", "only by derivation", "always permitted"). Picking
 * one creates the relationship and draws it — one undoable step, through the
 * same `modeling.connect` a connect drag ends in.
 *
 * The menu is empty when neither direction admits anything, which is what keeps
 * the pad entry away (`PopupMenu.isEmpty`, as for the other pad menus).
 */

import type { RelationshipTypeInfo } from '../../metamodel-manager/interfaces.js';
import type { RelationshipManager } from '../../model-manager/interfaces.js';
import { ENTRY_CLASS, preferenceNotes, relationshipEntryId, relationshipImageUrl, type RelationshipIconLookup } from './rdf-replace-menu-provider.js';

export const PAIR_CONNECT_MENU_ID = 'la-pair-connect';

/** One end of the pair: the shape on the canvas and the element it draws. */
export interface PairEnd {
  shapeId: string;
  iri: string;
  typeIri: string;
  label: string;
}

/** The two selected elements, in selection order. */
export interface PairConnectContext {
  a: PairEnd;
  b: PairEnd;
}

/** Turns the popup menu's target (the selection) into the pair, or nothing. */
export type PairConnectResolver = (target: unknown) => PairConnectContext | undefined;

/** Create the chosen relationship from `source` to `target`. */
export type PairConnectRequest = (source: PairEnd, target: PairEnd, candidate: RelationshipTypeInfo) => void;

/** An entry as diagram-js's popup menu takes it, grouped under its direction. */
export interface PairConnectMenuEntry {
  label: string;
  className: string;
  group: { id: string; name: string };
  title?: string;
  description?: string;
  search?: string;
  /** The relationship type's icon. */
  imageUrl?: string;
  action: (event: unknown) => void;
}

export class RdfPairConnectMenuProvider {
  constructor(
    private readonly relationshipManager: RelationshipManager,
    private readonly resolve: PairConnectResolver,
    private readonly connect: PairConnectRequest,
    /** A relationship type's icon, from the palette. */
    private readonly iconFor?: RelationshipIconLookup,
  ) {}

  /** The entries for the selected pair, both directions; empty when nothing connects them. */
  getPopupMenuEntries(target: unknown): Record<string, PairConnectMenuEntry> {
    const pair = this.resolve(target);
    if (!pair) return {};
    const entries: Record<string, PairConnectMenuEntry> = {};
    const directions: Array<[string, PairEnd, PairEnd]> = [
      ['forward', pair.a, pair.b],
      ['backward', pair.b, pair.a],
    ];
    for (const [id, source, target] of directions) {
      const group = { id, name: `${source.label} → ${target.label}` };
      for (const candidate of this.relationshipManager.getValidRelationships(source.typeIri, target.typeIri)) {
        const notes = preferenceNotes(candidate).join(' · ') || undefined;
        const imageUrl = relationshipImageUrl(candidate, this.iconFor);
        entries[`${id}-${relationshipEntryId(candidate.iri)}`] = {
          label: candidate.label,
          ...(imageUrl ? { imageUrl } : {}),
          className: ENTRY_CLASS,
          group,
          title: `${source.label} ${candidate.label} ${target.label}`,
          ...(candidate.reason || notes
            ? { description: [notes, candidate.reason].filter(Boolean).join(' — ') }
            : {}),
          search: `${candidate.label} ${source.label} ${target.label}`,
          action: () => this.connect(source, target, candidate),
        };
      }
    }
    return entries;
  }
}
