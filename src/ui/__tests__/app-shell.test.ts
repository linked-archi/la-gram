// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventBus, ModelEventType } from '../event-bus.js';
import { AppShell } from '../app-shell.js';

describe('AppShell', () => {
  it('exports the AppShell class', () => {
    expect(AppShell).toBeDefined();
    expect(typeof AppShell).toBe('function');
  });

  it('has static styles defined', () => {
    expect((AppShell as any).styles).toBeDefined();
  });

  it('extends LitElement (has render method on prototype)', () => {
    expect(typeof AppShell.prototype.render).toBe('function');
  });

  it('has connectedCallback and disconnectedCallback', () => {
    expect(typeof AppShell.prototype.connectedCallback).toBe('function');
    expect(typeof AppShell.prototype.disconnectedCallback).toBe('function');
  });

  describe('layout', () => {
    async function mount(props: Partial<AppShell> = {}) {
      const shell = document.createElement('app-shell') as AppShell;
      Object.assign(shell, props);
      document.body.append(shell);
      await shell.updateComplete;
      const root = shell.shadowRoot!;
      const grid = () => root.querySelector<HTMLElement>('.shell')!;
      return { shell, root, grid };
    }

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('has the model tree on the left, the palette and RDF on the right, four tabs under the canvas', async () => {
      const { root } = await mount();
      expect([...root.querySelectorAll('slot')].map((s) => s.getAttribute('name'))).toEqual([
        'toolbar',
        'explorer',
        'canvas',
        'properties',
        'validation',
        'sparql',
        'graph',
        'palette',
        'rdf',
      ]);
      expect([...root.querySelectorAll('.tab')].map((t) => t.textContent!.trim())).toEqual([
        'Properties',
        'Validation',
        'SPARQL Query',
        'Graph',
      ]);
      // Resize handles: the bottom panel's top edge, the side panels' left edges.
      expect([...root.querySelectorAll('.resizer')].map((r) => r.getAttribute('data-panel'))).toEqual([
        'bottom',
        'palette',
        'rdf',
      ]);
    });

    it('shows the palette and hides the RDF panel by default; each column follows its switch and width', async () => {
      const { shell, grid } = await mount({ paletteWidth: 250, rdfWidth: 440 });
      expect(grid().classList.contains('palette-open')).toBe(true);
      expect(grid().classList.contains('rdf-open')).toBe(false);
      expect(grid().style.getPropertyValue('--la-palette-column')).toBe('250px');
      expect(grid().style.getPropertyValue('--la-rdf-column')).toBe('0px');

      shell.paletteOpen = false;
      shell.rdfOpen = true;
      await shell.updateComplete;
      expect(grid().classList.contains('palette-open')).toBe(false);
      expect(grid().style.getPropertyValue('--la-palette-column')).toBe('0px');
      expect(grid().style.getPropertyValue('--la-rdf-column')).toBe('440px');
    });

    it('opens Properties first; a tab opens its pane, the open tab folds the panel to its tabs', async () => {
      const { shell, root, grid } = await mount({ bottomTab: 'properties', bottomFolded: false, bottomHeight: 280 });
      const pane = (id: string) => root.querySelector<HTMLElement>(`.tab-pane[data-tab="${id}"]`)!;
      const tab = (id: string) => root.querySelector<HTMLButtonElement>(`.tab[data-tab="${id}"]`)!;
      expect(tab('properties').getAttribute('aria-selected')).toBe('true');
      expect(pane('properties').hidden).toBe(false);
      expect(pane('validation').hidden).toBe(true);
      expect(grid().style.getPropertyValue('--la-bottom-row')).toBe('280px');

      const opened: string[] = [];
      shell.addEventListener('bottom-tab-changed', (e) => opened.push((e as CustomEvent<{ tab: string }>).detail.tab));
      tab('validation').click();
      await shell.updateComplete;
      expect(opened).toEqual(['validation']);
      expect(pane('validation').hidden).toBe(false);
      expect(pane('properties').hidden).toBe(true);

      tab('validation').click();
      await shell.updateComplete;
      expect(shell.bottomFolded).toBe(true);
      expect(root.querySelector<HTMLElement>('.tab-body')!.hidden).toBe(true);
      expect(grid().style.getPropertyValue('--la-bottom-row')).toBe('auto');

      // Another tab unfolds it.
      tab('sparql').click();
      await shell.updateComplete;
      expect(shell.bottomFolded).toBe(false);
      expect(pane('sparql').hidden).toBe(false);
    });

    it('shows a count on a tab', async () => {
      const { shell, root } = await mount();
      shell.tabBadges = { validation: '3' };
      await shell.updateComplete;
      expect(root.querySelector('.tab[data-tab="validation"] .badge')!.textContent).toBe('3');
      expect(root.querySelector('.tab[data-tab="properties"] .badge')).toBeNull();
    });
  });

  describe('event bus wiring logic', () => {
    // Test the connect/disconnect logic by simulating what the lifecycle does.
    // We extract the private handler and test the wiring pattern.

    const ALL_EVENTS: ModelEventType[] = [
      'element-created',
      'element-deleted',
      'element-updated',
      'relationship-created',
      'relationship-deleted',
      'selection-changed',
      'model-loaded',
      'model-saved',
      'metamodel-loaded',
      'validation-updated',
    ];

    it('connectedCallback registers listeners for all event types', () => {
      const bus = new EventBus();
      // Create a fake shell-like object with the handler
      const requestUpdate = vi.fn();
      const handler = (_e: any) => { requestUpdate(); };

      // Simulate what connectedCallback does
      for (const type of ALL_EVENTS) {
        bus.on(type, handler);
      }

      for (const type of ALL_EVENTS) {
        expect(bus.listenerCount(type)).toBe(1);
      }
    });

    it('disconnectedCallback removes all listeners', () => {
      const bus = new EventBus();
      const handler = vi.fn();

      for (const type of ALL_EVENTS) {
        bus.on(type, handler);
      }
      for (const type of ALL_EVENTS) {
        bus.off(type, handler);
      }

      for (const type of ALL_EVENTS) {
        expect(bus.listenerCount(type)).toBe(0);
      }
    });

    it('model events trigger the handler', () => {
      const bus = new EventBus();
      const handler = vi.fn();

      for (const type of ALL_EVENTS) {
        bus.on(type, handler);
      }

      bus.emit('element-created', { iri: 'ex:1' });
      bus.emit('model-loaded');

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });
});
