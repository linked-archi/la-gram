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
  /**
   * Another model is open, or the same one under new IRIs (`{ modelIri, viewIri }`): `fresh` for a new
   * model; `renamed` when it moved to another namespace — in Model settings, or by a merge or a version
   * from Git that has it under another IRI — `remote` when a collaborator replaced it — `previousModelIri`,
   * the IRI it had, when it is the same model moved.
   */
  | 'model-loaded'
  | 'model-saved'
  | 'metamodel-loaded'
  | 'palette-drag'
  | 'property-edited'
  | 'validation-updated'
  /** The canvas switched to another view (`{ viewIri }`). */
  | 'view-opened'
  /**
   * A view reference asked to open the view it references (`{ viewIri?, nodeIri }`): double-clicked, or its pad's
   * or its menu's *Open view* (Req 3.23). No `viewIri` when it names none.
   */
  | 'open-referenced-view'
  /** The format painter started, picked a look, or stopped (`{ state: 'pick' | 'paint' | 'off' }`). */
  | 'format-painter-changed'
  /** A view was created, renamed, re-pointed or deleted (`{ viewIri? }`). */
  | 'views-changed'
  /**
   * The model data changed in a way no finer event describes — a remote
   * collaborator's edit, an import, a migration (`{ remote?: boolean }`).
   * Listeners re-read what they show from the store.
   */
  | 'model-changed'
  /** Loaded metamodels changed (`{ metamodelIris }`). */
  | 'metamodels-changed'
  /** The presentation context (and so the notation set) changed. */
  | 'presentation-context-changed'
  /** Collaboration connection state changed (`{ status, room }`). */
  | 'collab-status'
  /** The set of connected collaborators, or their selections, changed. */
  | 'peers-changed'
  /** A message for the user (`{ level: 'info'|'warning'|'error', message }`). */
  | 'notify';

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
