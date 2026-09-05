/**
 * Event bus for model change events.
 * Panels subscribe to events and react to RDF store mutations.
 */

export type ModelEventType =
  | 'element-created'
  | 'element-deleted'
  | 'element-updated'
  | 'relationship-created'
  | 'relationship-deleted'
  | 'selection-changed'
  | 'model-loaded'
  | 'model-saved'
  | 'metamodel-loaded'
  | 'palette-drag'
  | 'property-edited'
  | 'validation-updated';

export interface ModelEvent {
  type: ModelEventType;
  detail?: Record<string, unknown>;
}

export type ModelEventHandler = (event: ModelEvent) => void;

export class EventBus {
  private listeners = new Map<ModelEventType, Set<ModelEventHandler>>();

  on(type: ModelEventType, handler: ModelEventHandler): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
  }

  off(type: ModelEventType, handler: ModelEventHandler): void {
    this.listeners.get(type)?.delete(handler);
  }

  emit(type: ModelEventType, detail?: Record<string, unknown>): void {
    const event: ModelEvent = { type, detail };
    this.listeners.get(type)?.forEach((handler) => handler(event));
  }

  clear(): void {
    this.listeners.clear();
  }

  listenerCount(type: ModelEventType): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}
