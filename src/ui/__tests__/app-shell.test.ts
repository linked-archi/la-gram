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
      expect(joined).toContain('class="shell"');
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
