// @vitest-environment jsdom
/**
 * `palette-panel` — the app's only palette, tested as a mounted custom element.
 *
 * The previous version of this file called the render method off the prototype
 * against a hand-built `this` and flattened the returned template literal to a
 * string. That could assert on markup, but not on behaviour: nothing was mounted,
 * so no listener ever ran, and the drag path — the panel's whole reason for
 * existing now that it owns the element types — was checked by invoking a private
 * method with a fake event.
 *
 * These tests mount the real element in jsdom and drive it through its shadow DOM
 * and real `MouseEvent`s, so the assertions are about what a user's press
 * produces.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PaletteDefinition, ViewpointInfo } from '../../../metamodel-manager/interfaces.js';
import { PalettePanel, type PaletteDragDetail } from '../palette-panel.js';

function testPalette(): PaletteDefinition {
  return {
    elementGroups: [
      {
        category: 'Business',
        elements: [
          { iri: 'arch:BP', label: 'Business Process', iconUrl: 'bp.svg', isAbstract: false },
          { iri: 'arch:BA', label: 'Business Actor', isAbstract: false },
          { iri: 'arch:AB', label: 'Abstract Business', isAbstract: true },
        ],
      },
      {
        category: 'Application',
        elements: [
          {
            iri: 'arch:AC',
            label: 'Application Component',
            iconUrl: 'ac.svg',
            isAbstract: false,
          },
        ],
      },
    ],
    relationshipTypes: [
      {
        iri: 'arch:serves',
        label: 'Serves',
        iconUrl: 'serves.svg',
        domainTypes: ['arch:AC'],
        rangeTypes: ['arch:BP'],
      },
      { iri: 'arch:accesses', label: 'Accesses', domainTypes: [], rangeTypes: [] },
    ],
  };
}

let panel: PalettePanel;

/** Mount the element and let Lit render once. */
async function mount(
  palette: PaletteDefinition = testPalette(),
  activeViewpoint?: ViewpointInfo,
): Promise<PalettePanel> {
  panel = document.createElement('palette-panel');
  panel.palette = palette;
  if (activeViewpoint) panel.activeViewpoint = activeViewpoint;
  document.body.appendChild(panel);
  await panel.updateComplete;
  return panel;
}

/** The shadow root, which is where everything the panel renders lives. */
function root(): ShadowRoot {
  const shadow = panel.shadowRoot;
  if (!shadow) throw new Error('palette-panel has no shadow root');
  return shadow;
}

const text = (): string => root().textContent ?? '';
const items = (): HTMLElement[] => Array.from(root().querySelectorAll('.palette-item'));
const labels = (): string[] =>
  items().map((item) => item.querySelector('.palette-label')?.textContent?.trim() ?? '');
const groupHeaders = (): HTMLElement[] => Array.from(root().querySelectorAll('.group-header'));

/** Collect every `palette-drag-start` the panel emits while `run` executes. */
async function captureDrags(run: () => void): Promise<PaletteDragDetail[]> {
  const seen: PaletteDragDetail[] = [];
  const listener = (e: Event): void => {
    seen.push((e as CustomEvent<PaletteDragDetail>).detail);
  };
  panel.addEventListener('palette-drag-start', listener);
  run();
  await panel.updateComplete;
  panel.removeEventListener('palette-drag-start', listener);
  return seen;
}

/** Find the entry for a label, element or relationship alike. */
function entry(label: string): HTMLElement {
  const found = items().find(
    (item) => item.querySelector('.palette-label')?.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no palette entry labelled "${label}" (have: ${labels().join(', ')})`);
  return found;
}

async function type(query: string): Promise<void> {
  const input = root().querySelector('input[type="search"]') as HTMLInputElement;
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await panel.updateComplete;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  panel?.remove();
});

describe('PalettePanel', () => {
  it('says when the types are grouped by the OWL-only fallback, and not otherwise', async () => {
    await mount({ ...testPalette(), grouping: 'owl' });
    expect(root().querySelector('.palette-notice')?.textContent).toContain('No classification loaded');
    panel.remove();
    await mount({ ...testPalette(), grouping: 'taxonomy' });
    expect(root().querySelector('.palette-notice')).toBeNull();
    panel.remove();
  });

  it('is registered as a custom element', () => {
    expect(customElements.get('palette-panel')).toBe(PalettePanel);
  });

  describe('what it offers', () => {
    it('groups the element types under their category headers', async () => {
      await mount();
      expect(groupHeaders().map((h) => h.textContent?.replace(/[▾\s]+/g, ' ').trim())).toEqual([
        'Business 2',
        'Application 1',
      ]);
    });

    it('lists every concrete type and no abstract one', async () => {
      await mount();
      expect(labels()).toEqual([
        'Business Process',
        'Business Actor',
        'Application Component',
        'Serves',
        'Accesses',
      ]);
      expect(text()).not.toContain('Abstract Business');
    });

    it('renders the relationships in their own section', async () => {
      await mount();
      expect(root().querySelector('.section-divider')?.textContent?.trim()).toBe('Relationships');
      expect(entry('Serves').dataset.kind).toBe('relationship');
      expect(entry('Business Actor').dataset.kind).toBe('element');
    });

    it('shows the published glyph, and a notation swatch when there is none', async () => {
      await mount({
        elementGroups: [
          {
            category: 'Business',
            elements: [
              { iri: 'arch:BP', label: 'With Icon', iconUrl: 'bp.svg', isAbstract: false },
              {
                iri: 'arch:BA',
                label: 'No Icon',
                isAbstract: false,
                style: { shapeType: 'Ellipse', fillColor: '#FFFFB5' },
              },
            ],
          },
        ],
        relationshipTypes: [],
      });

      expect(entry('With Icon').querySelector('img')?.getAttribute('src')).toContain('bp.svg');
      const swatch = entry('No Icon').querySelector('.palette-swatch');
      expect(swatch).not.toBeNull();
      expect(swatch!.classList.contains('ellipse')).toBe(true);
    });

    it('omits the relationships section when the metamodel publishes none', async () => {
      await mount({ elementGroups: testPalette().elementGroups, relationshipTypes: [] });
      expect(root().querySelector('.section-divider')).toBeNull();
    });

    it('says so when no metamodel is loaded', async () => {
      await mount({ elementGroups: [], relationshipTypes: [] });
      expect(items()).toHaveLength(0);
      expect(root().querySelector('.palette-empty')?.textContent).toContain('No metamodel loaded');
    });

    it('drops a group whose every type is abstract', async () => {
      await mount({
        elementGroups: [
          {
            category: 'OnlyAbstract',
            elements: [{ iri: 'a:1', label: 'A1', isAbstract: true }],
          },
        ],
        relationshipTypes: [],
      });
      expect(text()).not.toContain('OnlyAbstract');
    });
  });

  describe('collapsing a group', () => {
    it('hides its items on click and shows them again on the next', async () => {
      await mount();
      const header = groupHeaders()[0];

      header.click();
      await panel.updateComplete;
      const list = root().querySelector('.group-items') as HTMLElement;
      expect(list.classList.contains('hidden')).toBe(true);
      expect(root().querySelector('.group-toggle')!.classList.contains('collapsed')).toBe(true);

      header.click();
      await panel.updateComplete;
      expect(
        (root().querySelector('.group-items') as HTMLElement).classList.contains('hidden'),
      ).toBe(false);
    });
  });

  describe('search', () => {
    it('filters element and relationship types by label', async () => {
      await mount();
      await type('actor');
      expect(labels()).toEqual(['Business Actor']);

      await type('serv');
      expect(labels()).toEqual(['Serves']);
    });

    it('is case-insensitive and matches on a substring', async () => {
      await mount();
      await type('PROCESS');
      expect(labels()).toEqual(['Business Process']);
    });

    it('leaves what was typed alone, capitals and surrounding space included', async () => {
      // The query is normalised where the comparison happens, not in state: a
      // lower-cased state would rewrite the user's capitals back at them on every
      // keystroke.
      await mount();
      await type('  Business Actor  ');

      const input = root().querySelector('input[type="search"]') as HTMLInputElement;
      expect(input.value).toBe('  Business Actor  ');
      expect(labels()).toEqual(['Business Actor']);
    });

    it('quotes the query as typed when nothing matches', async () => {
      await mount();
      await type('No Such Type');
      expect(root().querySelector('.palette-empty')?.textContent).toContain('No Such Type');
    });

    it('reports a miss rather than rendering an empty panel', async () => {
      await mount();
      await type('nothing matches this');
      expect(items()).toHaveLength(0);
      expect(root().querySelector('.palette-empty')?.textContent).toContain('No type matches');
    });

    it('overrides a collapsed group, so a hit is never hidden', async () => {
      // A match buried in a group the user collapsed earlier would otherwise read
      // as "no results".
      await mount();
      groupHeaders()[0].click();
      await panel.updateComplete;
      expect((root().querySelector('.group-items') as HTMLElement).classList.contains('hidden')).toBe(
        true,
      );

      await type('actor');
      expect(labels()).toEqual(['Business Actor']);
      expect(
        (root().querySelector('.group-items') as HTMLElement).classList.contains('hidden'),
      ).toBe(false);
    });

    it('clears back to the full list', async () => {
      await mount();
      await type('actor');
      const clear = root().querySelector('.palette-search button') as HTMLButtonElement;
      expect(clear).not.toBeNull();

      clear.click();
      await panel.updateComplete;
      expect(labels()).toHaveLength(5);
      expect(root().querySelector('.palette-search button')).toBeNull();
    });

    it('narrows the group counts to what it shows', async () => {
      await mount();
      await type('business');
      expect(groupHeaders().map((h) => h.querySelector('.group-count')?.textContent)).toEqual(['2']);
    });
  });

  describe('starting a create gesture', () => {
    it('reports the type and forwards the raw mousedown', async () => {
      // The raw event is what `create.start` needs: `Dragging.init` takes the start
      // point, the touch flag and its `stopPropagation` from it.
      await mount();
      const press = new MouseEvent('mousedown', {
        bubbles: true,
        composed: true,
        clientX: 12,
        clientY: 34,
        button: 0,
      });

      const drags = await captureDrags(() => entry('Business Actor').dispatchEvent(press));

      expect(drags).toHaveLength(1);
      expect(drags[0]).toMatchObject({ iri: 'arch:BA', label: 'Business Actor', kind: 'element' });
      expect(drags[0].sourceEvent).toBe(press);
    });

    it('reports a click too, which is the click-to-place gesture', async () => {
      // `Create.start` arms `Dragging` with `autoActivate`. On a click the button is
      // already up, so the drag follows the pointer until the *next* click.
      await mount();
      const drags = await captureDrags(() =>
        entry('Business Actor').dispatchEvent(
          new MouseEvent('click', { bubbles: true, composed: true, button: 0 }),
        ),
      );
      expect(drags).toHaveLength(1);
    });

    it('ignores a non-primary button, so a right-click can reach a context menu', async () => {
      await mount();
      const drags = await captureDrags(() =>
        entry('Business Actor').dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, composed: true, button: 2 }),
        ),
      );
      expect(drags).toEqual([]);
    });

    it('marks a relationship pick as such, since there is no shape to drag', async () => {
      await mount();
      const drags = await captureDrags(() =>
        entry('Serves').dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, composed: true, button: 0 }),
        ),
      );
      expect(drags[0]).toMatchObject({ iri: 'arch:serves', kind: 'relationship' });
    });

    it('crosses the shadow boundary, so a listener on the host hears it', async () => {
      await mount();
      const seen: string[] = [];
      document.body.addEventListener('palette-drag-start', (e) => {
        seen.push((e as CustomEvent<PaletteDragDetail>).detail.iri);
      });

      entry('Business Actor').dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, composed: true, button: 0 }),
      );

      expect(seen).toEqual(['arch:BA']);
    });
  });

  describe('the "Group by" axis selector', () => {
    const axes = [
      { iri: 'ax:domain', label: 'Element by Domain' },
      { iri: 'ax:aspect', label: 'Element by Aspect' },
    ];

    it('is hidden unless the metamodel publishes more than one axis', async () => {
      await mount();
      expect(root().querySelector('#palette-axis')).toBeNull();

      await mount({ ...testPalette(), axes: [axes[0]], activeAxisIri: 'ax:domain' });
      expect(root().querySelector('#palette-axis')).toBeNull();
    });

    it('reports the chosen axis without regrouping anything itself', async () => {
      // Regrouping belongs to whoever owns the PaletteGenerator; the panel only
      // says which axis was asked for.
      await mount({ ...testPalette(), axes, activeAxisIri: 'ax:domain' });
      const select = root().querySelector('#palette-axis') as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.value)).toEqual(['ax:domain', 'ax:aspect']);

      let chosen: string | undefined;
      panel.addEventListener('palette-axis-change', (e) => {
        chosen = (e as CustomEvent<{ axisIri: string }>).detail.axisIri;
      });

      select.value = 'ax:aspect';
      select.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

      expect(chosen).toBe('ax:aspect');
      // Still grouped as before: nothing was regenerated locally.
      expect(groupHeaders()).toHaveLength(2);
    });
  });

  describe('viewpoint filtering', () => {
    const viewpoint: ViewpointInfo = {
      iri: 'vp:business',
      label: 'Business Viewpoint',
      permittedElements: ['arch:BP', 'arch:BA'],
      permittedRelationships: ['arch:serves'],
    };

    it('shows only the permitted types, and drops emptied groups', async () => {
      await mount(testPalette(), viewpoint);
      expect(labels()).toEqual(['Business Process', 'Business Actor', 'Serves']);
      expect(text()).not.toContain('Application');
    });

    it('shows everything when no viewpoint is active', async () => {
      await mount(testPalette());
      expect(labels()).toHaveLength(5);
    });

    it('hides the relationships section when the viewpoint permits none', async () => {
      await mount(testPalette(), {
        iri: 'vp:norels',
        label: 'No Rels',
        permittedElements: ['arch:BP'],
        permittedRelationships: [],
      });
      expect(root().querySelector('.section-divider')).toBeNull();
      expect(labels()).toEqual(['Business Process']);
    });

    it('leaves an empty palette when the viewpoint permits nothing', async () => {
      await mount(testPalette(), {
        iri: 'vp:empty',
        label: 'Empty',
        permittedElements: [],
        permittedRelationships: [],
      });
      expect(items()).toHaveLength(0);
      expect(text()).toContain('Palette');
    });

    it('composes with the search box', async () => {
      await mount(testPalette(), viewpoint);
      await type('business');
      expect(labels()).toEqual(['Business Process', 'Business Actor']);
    });
  });

  describe('which type an entry is', () => {
    const prefixed = (iri: string) => iri.replace('https://ex.org/am4#', 'am4:').replace('https://ex.org/basic#', 'basic:');
    const twoLanguages = (): PaletteDefinition => ({
      elementGroups: [
        { category: 'Business', elements: [{ iri: 'https://ex.org/am4#Actor', label: 'Business Actor', isAbstract: false }] },
        // The same type in a second group is not another type of that name.
        { category: 'Other', elements: [{ iri: 'https://ex.org/am4#Actor', label: 'Business Actor', isAbstract: false }, { iri: 'https://ex.org/basic#Node', label: 'Node', isAbstract: false }] },
      ],
      relationshipTypes: [
        { iri: 'https://ex.org/am4#Aggregation', label: 'Aggregation', domainTypes: [], rangeTypes: [] },
        { iri: 'https://ex.org/basic#Aggregation', label: 'Aggregation', domainTypes: [], rangeTypes: [] },
      ],
    });

    it('names its prefixed IRI in the tooltip, and the prefix beside a name another loaded language uses too', async () => {
      panel = document.createElement('palette-panel');
      panel.palette = twoLanguages();
      panel.prefixedName = prefixed;
      document.body.appendChild(panel);
      await panel.updateComplete;
      const tags = items().map((item) => [item.querySelector('.palette-label')!.textContent!.trim(), item.querySelector('.palette-tag')?.textContent ?? '']);
      expect(tags).toEqual([
        ['Business Actor', ''],
        ['Business Actor', ''],
        ['Node', ''],
        ['Aggregation', 'am4'],
        ['Aggregation', 'basic'],
      ]);
      expect(items()[4]!.title).toBe('Aggregation — basic:Aggregation');
      // The search matches the prefixed name: one language's types.
      await type('basic:');
      expect(labels()).toEqual(['Node', 'Aggregation']);
    });

    it('says which entry is under the pointer, and when it leaves', async () => {
      await mount(twoLanguages());
      const seen: Array<string | undefined> = [];
      panel.addEventListener('palette-hover', (e) => seen.push((e as CustomEvent<{ iri?: string }>).detail.iri));
      const node = entry('Node');
      node.dispatchEvent(new Event('pointerenter'));
      node.dispatchEvent(new Event('pointerleave'));
      expect(seen).toEqual(['https://ex.org/basic#Node', undefined]);
    });
  });
});
