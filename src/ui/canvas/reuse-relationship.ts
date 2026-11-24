/**
 * Drawing a relationship the model already has.
 *
 * A line drawn from one element to another, of a type the model already
 * relates them by in that direction but that this view does not draw — it is
 * drawn in another view, or in none — is likely that relationship again rather
 * than a second one. So the modeller is asked: the existing one, drawn here too
 * (one relationship, shown in two views), or a new one. Esc draws nothing.
 *
 * `RdfModeling.connect` asks through {@link RdfReuseCheck} before it creates,
 * and does not create while the question is open; the answer draws the
 * existing relationship, or connects again, answered.
 */

import { assetUrl } from '@linked-archi/kernel/metamodel-manager/bundled-assets.js';
import { iconHref } from './notation-shapes.js';

/** Popup menu id of the "the model already has it" menu. */
export const REUSE_MENU_ID = 'la-reuse-relationship';

/** A relationship the model already has between the two, of the type drawn. */
export interface ReuseCandidate {
  iri: string;
  /** Its name, when it has one. */
  name?: string;
}

/** What the menu is for: set by the canvas as it opens it. */
export interface PendingReuse {
  typeIri: string;
  typeLabel: string;
  sourceLabel: string;
  targetLabel: string;
  existing: ReuseCandidate[];
  /** Draw this one in the view. */
  useExisting(iri: string): void;
  /** Create another, as the line asked. */
  createNew(): void;
}

/**
 * Asked by `RdfModeling.connect` before it creates a relationship: true when
 * the model already has one of the type between the two, in that direction,
 * not drawn in this view — the question is then asked, and nothing is created
 * now; `createNew` connects again with the question answered.
 */
export type RdfReuseCheck = (request: {
  source: { businessObject?: { iri?: string; label?: string } };
  target: { businessObject?: { iri?: string; label?: string } };
  typeIri: string;
  createNew: () => void;
}) => boolean;

/** The menu: each existing relationship, then a new one. */
export class RdfReuseMenuProvider {
  pending: PendingReuse | undefined;

  /** @param iconFor The icon of a relationship type, as the palette publishes it. */
  constructor(private readonly iconFor?: (relationshipTypeIri: string) => string | undefined) {}

  getPopupMenuEntries(_target: unknown): Record<string, unknown> {
    const pending = this.pending;
    if (!pending) return {};
    const imageUrl = iconHref(this.iconFor?.(pending.typeIri), assetUrl) ?? undefined;
    const between = `${pending.sourceLabel} → ${pending.targetLabel}`;
    const entries: Record<string, unknown> = {};
    pending.existing.forEach((candidate, index) => {
      entries[`la-reuse-${index}`] = {
        label: candidate.name ? `Use “${candidate.name}”` : `Use the existing ${pending.typeLabel}`,
        className: 'la-reuse-entry',
        ...(imageUrl ? { imageUrl } : {}),
        title: 'The relationship the model already has, drawn in this view too: one relationship, in both views',
        description: between,
        action: () => pending.useExisting(candidate.iri),
      };
    });
    entries['la-reuse-new'] = {
      label: `New ${pending.typeLabel}`,
      className: 'la-reuse-entry',
      ...(imageUrl ? { imageUrl } : {}),
      title: 'Another relationship of this type between the two',
      description: between,
      action: () => pending.createNew(),
    };
    return entries;
  }
}
