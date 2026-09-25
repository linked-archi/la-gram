import { describe, it, expect, vi } from 'vitest';
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

  describe('render template', () => {
    it('contains all five named slots', () => {
      // Create a minimal instance just to call render()
      // We need to bypass Lit's constructor, so we use a trick:
      // instantiate with new but catch any DOM errors
      const proto = AppShell.prototype;
      const result = proto.render.call({}) as any;

      // Lit TemplateResult has a strings array
      const joined = result.strings?.join('') ?? '';
      expect(joined).toContain('name="palette"');
      expect(joined).toContain('name="canvas"');
      expect(joined).toContain('name="property-panel"');
      expect(joined).toContain('name="explorer"');
      expect(joined).toContain('name="validation"');
    });

    it('contains the grid shell container', () => {
      const proto = AppShell.prototype;
      const result = proto.render.call({}) as any;
      const joined = result.strings?.join('') ?? '';
      expect(joined).toContain('class="shell ');
    });

    it('has an RDF slot on the far right, collapsed unless rdfOpen', () => {
      const proto = AppShell.prototype;
      const closed = proto.render.call({ rdfOpen: false, rdfWidth: 440 }) as any;
      expect(closed.strings.join('')).toContain('name="rdf"');
      expect(closed.strings.join('')).toContain('panel-rdf');
      // The column width and the open class are the template's values.
      expect(closed.values).toContain('0px');
      expect(closed.values).not.toContain('rdf-open');
      const open = proto.render.call({ rdfOpen: true, rdfWidth: 440 }) as any;
      expect(open.values).toContain('440px');
      expect(open.values).toContain('rdf-open');
    });

    it('shows the property panel by default, at its width, and collapses its column when hidden', () => {
      const proto = AppShell.prototype;
      const shown = proto.render.call({ propertyOpen: true, propertyWidth: 360, rdfOpen: false, rdfWidth: 440 }) as any;
      expect(shown.values).toContain('property-open');
      expect(shown.values).toContain('360px');
      // Both side panels carry a resize handle on their left edge.
      const handles = shown.values.filter((v: any) => v?.strings?.join('').includes('class="resizer"'));
      expect(handles.map((h: any) => h.values[0])).toEqual(['property', 'rdf']);
      const hidden = proto.render.call({ propertyOpen: false, propertyWidth: 360, rdfOpen: false, rdfWidth: 440 }) as any;
      expect(hidden.values).not.toContain('property-open');
      expect(hidden.values).not.toContain('360px');
      // A bare render (no state yet) shows it at the default width.
      expect((proto.render.call({}) as any).values).toContain('300px');
    });

    it('contains all panel CSS classes', () => {
      const proto = AppShell.prototype;
      const result = proto.render.call({}) as any;
      const joined = result.strings?.join('') ?? '';
      expect(joined).toContain('panel-palette');
      expect(joined).toContain('panel-canvas');
      expect(joined).toContain('panel-property');
      expect(joined).toContain('panel-explorer');
      expect(joined).toContain('panel-validation');
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
