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

/** The tools' buttons — not the switch after them. */
const buttons = (): HTMLButtonElement[] =>
  Array.from(root().querySelectorAll('button[data-tool]')) as HTMLButtonElement[];

const namesSwitch = (): HTMLButtonElement => {
  const found = root().querySelector<HTMLButtonElement>('button[data-switch="relationship-names"]');
  if (!found) throw new Error('no Relationship names switch');
  return found;
};

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

  it('has a Relationship names switch after the tools: off by default, asking for the other state, pressed as it is told', async () => {
    await mount();
    expect(namesSwitch().textContent?.trim()).toBe('Relationship names');
    expect(namesSwitch().getAttribute('aria-pressed')).toBe('false');
    const asked: boolean[] = [];
    document.body.addEventListener('relationship-names', (e) => asked.push((e as CustomEvent<{ shown: boolean }>).detail.shown));

    namesSwitch().click();
    expect(asked).toEqual([true]);
    // Not flipped by the click itself: the host decides, and tells it.
    expect(namesSwitch().getAttribute('aria-pressed')).toBe('false');

    toolbar.relationshipNames = true;
    await toolbar.updateComplete;
    expect(namesSwitch().getAttribute('aria-pressed')).toBe('true');
    namesSwitch().click();
    expect(asked).toEqual([true, false]);
  });

  it('offers Arrange view… as an icon beside the format painter, a button the size of the tools', async () => {
    await mount();
    const arrange = root().querySelector<HTMLButtonElement>('button[data-action="arrange-view"]')!;
    // An icon, no words: the words made it wider than its 26px and ran over the format painter.
    expect(arrange.textContent?.trim()).toBe('');
    expect(arrange.querySelector('svg')).not.toBeNull();
    expect(arrange.classList.contains('switch')).toBe(false);
    expect(arrange.getAttribute('aria-label')).toBe('Arrange view…');
    expect(arrange.previousElementSibling?.getAttribute('data-action')).toBe('format-painter');
    let asked = 0;
    document.body.addEventListener('arrange-view', () => asked++);
    arrange.click();
    expect(asked).toBe(1);
  });

  it('opens the four arrange dialogs from the menu beside Arrange view (Req 22.1)', async () => {
    await mount();
    const toggle = root().querySelector<HTMLButtonElement>('button[data-action="arrange-menu"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await toolbar.updateComplete;
    const items = Array.from(root().querySelectorAll<HTMLButtonElement>('.menu button'));
    expect(items.map((b) => b.textContent?.trim())).toEqual(['Arrange view…', 'Arrange relationships…', 'Align to grid…', 'Sizes…']);
    const dialogs: string[] = [];
    let view = 0;
    document.body.addEventListener('arrange-dialog', (e) => dialogs.push((e as CustomEvent<{ dialog: string }>).detail.dialog));
    document.body.addEventListener('arrange-view', () => view++);
    items[3].click();
    await toolbar.updateComplete;
    // Picking closes the menu.
    expect(root().querySelector('.menu')).toBeNull();
    toggle.click();
    await toolbar.updateComplete;
    root().querySelector<HTMLButtonElement>('.menu button[data-menu="arrange-view"]')!.click();
    expect([dialogs, view]).toEqual([['sizes'], 1]);
  });

  it('offers the quick actions, each enabled once enough is selected (Req 22.1)', async () => {
    await mount();
    const quick = (action: string) => root().querySelector<HTMLButtonElement>(`button[data-quick="${action}"]`)!;
    const asked: string[] = [];
    document.body.addEventListener('arrange-quick', (e) => asked.push((e as CustomEvent<{ action: string }>).detail.action));
    // Nothing selected: what acts on the whole view is offered; aligning, distributing and matching are not.
    expect(['align-left', 'distribute-horizontal', 'match-width', 'default-size', 'align-to-grid', 'arrange-relationships'].map((a) => quick(a).disabled)).toEqual([
      true, true, true, false, false, false,
    ]);
    toolbar.arrangeSelected = 2;
    await toolbar.updateComplete;
    expect([quick('align-left').disabled, quick('distribute-vertical').disabled, quick('match-size').disabled]).toEqual([false, true, false]);
    toolbar.arrangeSelected = 3;
    await toolbar.updateComplete;
    quick('distribute-vertical').click();
    quick('align-bottom').click();
    expect(asked).toEqual(['distribute-vertical', 'align-bottom']);
  });

  it('Line shape: disabled until a line is selected, then a menu of the four shapes, each picked once (Req 22.9)', async () => {
    await mount();
    const button = root().querySelector<HTMLButtonElement>('button[data-action="line-shape-menu"]')!;
    expect(button.getAttribute('aria-label')).toBe('Line shape');
    expect(button.disabled).toBe(true);
    toolbar.linesSelected = 1;
    await toolbar.updateComplete;
    expect(button.disabled).toBe(false);

    // Opening it closes the arrange menu.
    root().querySelector<HTMLButtonElement>('button[data-action="arrange-menu"]')!.click();
    await toolbar.updateComplete;
    button.click();
    await toolbar.updateComplete;
    expect(root().querySelector('button[data-action="arrange-menu"]')!.getAttribute('aria-expanded')).toBe('false');
    const items = Array.from(root().querySelectorAll<HTMLButtonElement>('.menu button[data-line-shape]'));
    expect(items.map((b) => b.textContent?.trim())).toEqual(['Straight', 'Right angles', 'Horizontal first', 'Vertical first']);
    expect(items.every((b) => b.querySelector('svg'))).toBe(true);

    const picked: string[] = [];
    document.body.addEventListener('line-shape', (e) => picked.push((e as CustomEvent<{ shape: string }>).detail.shape));
    items[2].click();
    await toolbar.updateComplete;
    expect(picked).toEqual(['horizontal-first']);
    expect(root().querySelector('.menu')).toBeNull();

    // The selection gone, the menu closes.
    button.click();
    await toolbar.updateComplete;
    toolbar.linesSelected = 0;
    await toolbar.updateComplete;
    await toolbar.updateComplete;
    expect(root().querySelector('.menu')).toBeNull();
  });

  it('says in the match and grid buttons what their dialogs last chose', async () => {
    await mount();
    const title = (action: string) => root().querySelector(`button[data-quick="${action}"]`)!.getAttribute('title');
    expect(title('match-width')).toContain('to the largest');
    expect(title('align-to-grid')).toContain('20 px');
    toolbar.sizeReference = 'median';
    toolbar.grid = { grid: 40, axis: 'y' };
    await toolbar.updateComplete;
    expect(title('match-width')).toContain('to the median');
    expect(title('align-to-grid')).toContain('40 px, down');
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
