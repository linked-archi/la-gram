/**
 * Property picker — the "add a property" field of the property panel.
 *
 * A search field over the properties that apply to the selected concept
 * (`model-manager/property-catalog.ts`), listed in groups: for the concept's
 * type, used in this model, documentation, and — collapsed until asked for or
 * searched — the rest. Each entry shows the property's name first and its
 * prefixed IRI underneath, smaller: the name is what one looks for, the IRI is
 * there for when it matters.
 *
 * Anything can be typed: when the text is not one of the entries, the last row
 * offers it as a new property — a plain name in the model's namespace
 * (`owner` → `m:owner`), a CURIE, or a full IRI.
 *
 * The list itself is the named picker's (`named-picker.ts`).
 */

import { customElement, property } from 'lit/decorators.js';
import type { PropertySuggestion, ResolvedProperty } from '@linked-archi/kernel/model-manager/property-catalog.js';
import { NamedPicker, type NamedOption } from './named-picker.js';

/** Detail of `property-picked`. */
export interface PropertyPickedDetail {
  iri: string;
  label: string;
  curie: string;
}

@customElement('property-picker')
export class PropertyPicker extends NamedPicker {
  /** The properties to offer; asked each time the list opens, so it is current. */
  @property({ attribute: false }) suggest?: () => PropertySuggestion[];

  /** What typed text means as a property, or `undefined`. */
  @property({ attribute: false }) resolve?: (text: string) => ResolvedProperty | undefined;

  constructor() {
    super();
    this.placeholder = 'Add a property…';
    this.label = 'Property to add';
    this.hint = 'Type a name (a new property in this model), a prefixed name such as dcterms:source, or an IRI.';
    this.showChosen = true;
    this.options = () =>
      (this.suggest?.() ?? []).map((s) => ({
        iri: s.iri,
        label: s.label,
        iriText: s.curie,
        groupLabel: s.groupLabel,
        ...(s.group === 'more' ? { more: true } : {}),
        ...(s.description ? { description: s.description } : {}),
      }));
    this.typed = (text) => {
      const resolved = this.resolve?.(text);
      return resolved
        ? { iri: resolved.iri, label: resolved.label, iriText: resolved.curie, prefix: '＋ New property: ' }
        : undefined;
    };
  }

  /** The chosen property: the one picked from the list, else what the typed text resolves to. */
  get value(): PropertyPickedDetail | undefined {
    const chosen = this.choice;
    return chosen ? { iri: chosen.iri, label: chosen.label, curie: chosen.iriText ?? chosen.iri } : undefined;
  }

  protected override announce(option: NamedOption): void {
    this.dispatchEvent(
      new CustomEvent<PropertyPickedDetail>('property-picked', {
        detail: { iri: option.iri, label: option.label, curie: option.iriText ?? option.iri },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'property-picker': PropertyPicker;
  }
}
