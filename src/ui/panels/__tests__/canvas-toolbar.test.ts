// @vitest-environment jsdom
/**
 * `canvas-toolbar` — the strip above the diagram holding the global tools.
 *
 * Mounted for real, and driven by clicks on its buttons, because the two things
 * worth asserting are both behavioural: that a click forwards the raw event (which
 * diagram-js's drag-driven tools seed themselves from), and that the pressed state
 * follows what `ToolManager` reports rather than what was last clicked.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasToolbar, type ToolbarToolDetail } from '../canvas-toolbar.js';
import { CANVAS_TOOLS, toolFromManagerName } from '../../canvas/canvas-tools.js';

let toolbar: CanvasToolbar;

async function mount(): Promise<CanvasToolbar> {
  toolbar = document.createElement('canvas-toolbar');
  document.body.appendChild(toolbar);
  await toolbar.updateComplete;
  return toolbar;
}

function root(): ShadowRoot {
  const shadow = toolbar.shadowRoot;
  if (!shadow) throw new Error('canvas-toolbar has no shadow root');
  return shadow;
}

const buttons = (): HTMLButtonElement[] =>
  Array.from(root().querySelectorAll('button')) as HTMLButtonElement[];

const button = (tool: string): HTMLButtonElement => {
  const found = buttons().find((b) => b.dataset.tool === tool);
  if (!found) throw new Error(`no toolbar button for "${tool}"`);
  return found;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  toolbar?.remove();
});

describe('CanvasToolbar', () => {
  it('is registered as a custom element', () => {
    expect(customElements.get('canvas-toolbar')).toBe(CanvasToolbar);
  });

  it('offers exactly the canvas tools, in order', async () => {
    await mount();
    expect(buttons().map((b) => b.dataset.tool)).toEqual(CANVAS_TOOLS.map((t) => t.tool));
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(
      CANVAS_TOOLS.map((t) => t.glyph),
    );
  });

  it('is reachable without a mouse', async () => {
    // Real `<button>`s inside a `role="toolbar"`, so keyboard operation and the
    // accessible name come for free rather than needing ARIA wiring.
    await mount();
    expect(root().querySelector('[role="toolbar"]')).not.toBeNull();
    for (const info of CANVAS_TOOLS) {
      expect(button(info.tool).getAttribute('aria-label')).toBe(info.title);
      expect(button(info.tool).type).toBe('button');
    }
  });

  it('reports the tool and forwards the raw click', async () => {
    // Forwarding matters: `GlobalConnect.start(event, autoActivate)` and
    // `LassoTool.activateSelection(event, autoActivate)` seed `Dragging` from it.
    await mount();
    const seen: ToolbarToolDetail[] = [];
    toolbar.addEventListener('toolbar-tool', (e) => {
      seen.push((e as CustomEvent<ToolbarToolDetail>).detail);
    });

    button('lasso').click();

    expect(seen).toHaveLength(1);
    expect(seen[0].tool).toBe('lasso');
    expect(seen[0].sourceEvent).toBeInstanceOf(MouseEvent);
    expect(seen[0].sourceEvent.type).toBe('click');
  });

  it('crosses the shadow boundary, so a listener on the host hears it', async () => {
    await mount();
    const seen: string[] = [];
    document.body.addEventListener('toolbar-tool', (e) => {
      seen.push((e as CustomEvent<ToolbarToolDetail>).detail.tool);
    });

    button('hand').click();

    expect(seen).toEqual(['hand']);
  });

  it('presses the button for the armed tool, and only that one', async () => {
    await mount();
    expect(buttons().map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
    ]);

    toolbar.activeTool = 'hand';
    await toolbar.updateComplete;
    expect(button('hand').getAttribute('aria-pressed')).toBe('true');
    expect(button('lasso').getAttribute('aria-pressed')).toBe('false');

    // Not inferred from clicks: the state is whatever it is told, which is what
    // lets a tool diagram-js dropped on its own stop showing as active.
    toolbar.activeTool = undefined;
    await toolbar.updateComplete;
    expect(buttons().every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
  });
});

describe('toolFromManagerName', () => {
  it('maps every diagram-js tool name back to this app\'s id', () => {
    // The names differ — diagram-js calls the connect tool `global-connect` — so a
    // toolbar that assumed they matched would never highlight it.
    for (const info of CANVAS_TOOLS) {
      expect(toolFromManagerName(info.toolManagerName)).toBe(info.tool);
    }
    expect(CANVAS_TOOLS.find((t) => t.tool === 'connect')?.toolManagerName).toBe('global-connect');
  });

  it('reads "no tool armed" from null, undefined and an unknown name', () => {
    expect(toolFromManagerName(null)).toBeNull();
    expect(toolFromManagerName(undefined)).toBeNull();
    expect(toolFromManagerName('space-tool')).toBeNull();
  });
});
