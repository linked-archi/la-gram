// @vitest-environment jsdom

/**
 * Regression: diagram-js's `keyboard` must not steal keystrokes aimed at a text
 * field inside a shadow root.
 *
 * ## The bug
 *
 * `Keyboard._isEventIgnored` asks `isInput(event.target)` whether a key belongs to
 * a text field. Every panel in this app is a Lit component, so its inputs live in
 * a shadow root, and `keyboard` is bound to `document` — where a `keydown` from
 * inside a shadow root has already been **retargeted** to the component host. So
 * `event.target` is `<palette-panel>`, `isInput` says no, `editorActions` claims
 * the key, and `_keyHandler` calls `preventDefault()`.
 *
 * The visible symptom was that Backspace and Delete did nothing in the palette's
 * search box: the browser was told not to edit the text. It applied to every Lit
 * input in the app, and it was invisible to a test that only dispatched events at
 * light-DOM nodes.
 *
 * These tests dispatch from a real shadow root and assert on `defaultPrevented`,
 * which is precisely the flag that decides whether the browser edits the field.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode } from '@rdfjs/types';

import { DiagramCanvas } from '../diagram-canvas.js';
import { EventBus } from '../../event-bus.js';
import type { ElementManager, RelationshipManager } from '../../../model-manager/interfaces.js';
import type { PaletteDefinition } from '../../../metamodel-manager/interfaces.js';
import { installJsdomSvgSupport } from '../../__tests__/jsdom-svg-support.js';

installJsdomSvgSupport();

const { namedNode } = DataFactory;

const MODEL_IRI = 'https://example.org/model/test';
const TYPE_A = 'https://example.org/mm#TypeA';

let canvas: DiagramCanvas;
let container: HTMLElement;

function palette(): PaletteDefinition {
  return {
    elementGroups: [
      { category: 'Test', elements: [{ iri: TYPE_A, label: 'Type A', isAbstract: false }] },
    ],
    relationshipTypes: [],
  };
}

function elementManager(): ElementManager {
  let n = 0;
  return {
    createElement: vi.fn(
      () => namedNode(`https://example.org/model/new-${++n}`) as unknown as NamedNode,
    ),
    updateProperty: vi.fn(),
    deleteElement: vi.fn(),
    updateLayout: vi.fn(),
  };
}

function relationshipManager(): RelationshipManager {
  return {
    getValidRelationships: vi.fn().mockReturnValue([]),
    createRelationship: vi.fn(() => namedNode('urn:rel') as unknown as NamedNode),
    deleteRelationship: vi.fn(),
  };
}

/**
 * A host with a closed-over `<input>` in its shadow root, standing in for any of
 * the app's Lit panels. Deliberately hand-rolled rather than using `palette-panel`,
 * so the test is about shadow-DOM retargeting and not about one panel's markup.
 */
function shadowInput(): HTMLInputElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const input = document.createElement('input');
  input.type = 'search';
  shadow.appendChild(input);
  return input;
}

function keydown(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
}

/** The shape ids diagram-js currently holds, root and connections excluded. */
function shapeIds(): string[] {
  const registry = (
    canvas.getDiagram() as unknown as {
      get(n: string): { getAll(): { id: string; parent?: unknown; waypoints?: unknown }[] };
    }
  ).get('elementRegistry');
  return registry
    .getAll()
    .filter((element) => element.parent && !element.waypoints)
    .map((element) => element.id);
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  canvas = new DiagramCanvas({
    container,
    eventBus: new EventBus(),
    elementManager: elementManager(),
    relationshipManager: relationshipManager(),
    paletteDefinition: palette(),
    modelIri: MODEL_IRI,
    // The production default, and the reason the bug existed at all.
    keyboardBindTo: document,
  });
});

afterEach(() => {
  canvas.destroy();
  document.body.innerHTML = '';
});

describe('the keyboard guard', () => {
  it('binds diagram-js keyboard handling to the document', () => {
    const keyboard = (
      canvas.getDiagram() as unknown as { get(n: string): { getBinding(): EventTarget | null } }
    ).get('keyboard');
    expect(keyboard.getBinding()).toBe(document);
  });

  it('leaves Backspace to a text field inside a shadow root', () => {
    // The actual bug. Retargeting hides the input from `isInput`, so without the
    // guard `removeSelection` claims the key and `preventDefault()` stops the
    // browser deleting the character.
    const input = shadowInput();
    const event = keydown('Backspace');

    input.dispatchEvent(event);

    expect(event.defaultPrevented, 'Backspace was swallowed by the diagram').toBe(false);
  });

  it('leaves Delete to it too, and does not delete the selected shape', () => {
    canvas.addElement('urn:e:1', TYPE_A, { x: 10, y: 10, width: 100, height: 50 });
    const selection = (
      canvas.getDiagram() as unknown as { get(n: string): { select(e: unknown): void } }
    ).get('selection');
    const registry = (
      canvas.getDiagram() as unknown as { get(n: string): { get(id: string): unknown } }
    ).get('elementRegistry');
    selection.select(registry.get('urn:e:1'));
    expect(shapeIds()).toContain('urn:e:1');

    const input = shadowInput();
    const event = keydown('Delete');
    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    // Typing in a search box must not remove whatever happens to be selected.
    expect(shapeIds()).toContain('urn:e:1');
  });

  it('leaves modified keys alone too, unlike stock diagram-js', () => {
    // A deliberate deviation: upstream lets Cmd/Ctrl combos through from an input,
    // so Ctrl+Z typed into a textarea undoes a *diagram* command. In an app whose
    // panels are all text editors, that is a bug.
    const input = shadowInput();

    for (const key of ['z', 'y', 'a']) {
      const event = keydown(key, { ctrlKey: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented, `Ctrl+${key} was swallowed`).toBe(false);
    }
  });

  it('still lets the diagram handle keys from outside any text field', () => {
    // The guard has to be narrow: Delete on the canvas must still delete.
    canvas.addElement('urn:e:1', TYPE_A, { x: 10, y: 10, width: 100, height: 50 });
    const selection = (
      canvas.getDiagram() as unknown as { get(n: string): { select(e: unknown): void } }
    ).get('selection');
    const registry = (
      canvas.getDiagram() as unknown as { get(n: string): { get(id: string): unknown } }
    ).get('elementRegistry');
    selection.select(registry.get('urn:e:1'));

    const event = keydown('Delete');
    container.dispatchEvent(event);

    expect(event.defaultPrevented, 'the diagram did not claim Delete').toBe(true);
    expect(shapeIds()).not.toContain('urn:e:1');
  });

  it('still honours a light-DOM input, which is what upstream already handled', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);

    const event = keydown('Backspace');
    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('guards a <select> as well, so the axis selector keeps its arrow keys', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const select = document.createElement('select');
    host.attachShadow({ mode: 'open' }).appendChild(select);

    const event = keydown('ArrowDown');
    select.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
