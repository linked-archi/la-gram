import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus, ModelEventType } from '../event-bus.js';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('calls handler when matching event is emitted', () => {
    const handler = vi.fn();
    bus.on('element-created', handler);
    bus.emit('element-created', { iri: 'ex:1' });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      type: 'element-created',
      detail: { iri: 'ex:1' },
    });
  });

  it('does not call handler for non-matching event types', () => {
    const handler = vi.fn();
    bus.on('element-created', handler);
    bus.emit('element-deleted');

    expect(handler).not.toHaveBeenCalled();
  });

  it('supports multiple handlers for the same event type', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('model-loaded', h1);
    bus.on('model-loaded', h2);
    bus.emit('model-loaded');

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('removes a handler with off()', () => {
    const handler = vi.fn();
    bus.on('selection-changed', handler);
    bus.off('selection-changed', handler);
    bus.emit('selection-changed');

    expect(handler).not.toHaveBeenCalled();
  });

  it('emits with no detail when detail is omitted', () => {
    const handler = vi.fn();
    bus.on('validation-updated', handler);
    bus.emit('validation-updated');

    expect(handler).toHaveBeenCalledWith({
      type: 'validation-updated',
      detail: undefined,
    });
  });

  it('does nothing when emitting with no listeners', () => {
    expect(() => bus.emit('element-updated')).not.toThrow();
  });

  it('does nothing when removing a handler that was never added', () => {
    const handler = vi.fn();
    expect(() => bus.off('element-created', handler)).not.toThrow();
  });

  it('clears all listeners', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('element-created', h1);
    bus.on('element-deleted', h2);
    bus.clear();
    bus.emit('element-created');
    bus.emit('element-deleted');

    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it('reports correct listener count', () => {
    expect(bus.listenerCount('element-created')).toBe(0);

    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('element-created', h1);
    expect(bus.listenerCount('element-created')).toBe(1);

    bus.on('element-created', h2);
    expect(bus.listenerCount('element-created')).toBe(2);

    bus.off('element-created', h1);
    expect(bus.listenerCount('element-created')).toBe(1);
  });

  it('handles all defined event types', () => {
    const types: ModelEventType[] = [
      'element-created',
      'element-deleted',
      'element-updated',
      'relationship-created',
      'relationship-deleted',
      'selection-changed',
      'model-loaded',
      'validation-updated',
    ];
    const handler = vi.fn();

    for (const type of types) {
      bus.on(type, handler);
    }
    for (const type of types) {
      bus.emit(type, { type });
    }

    expect(handler).toHaveBeenCalledTimes(types.length);
  });

  it('does not duplicate handler if added twice', () => {
    const handler = vi.fn();
    bus.on('element-created', handler);
    bus.on('element-created', handler);
    bus.emit('element-created');

    // Set-based storage means same reference is stored once
    expect(handler).toHaveBeenCalledOnce();
  });
});
