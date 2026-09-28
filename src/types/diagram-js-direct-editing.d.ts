/**
 * Types for `diagram-js-direct-editing`, which ships none — only the class
 * la-gram uses, as far as it uses it (`ui/canvas/rdf-label-editing.ts`).
 */
declare module 'diagram-js-direct-editing/lib/DirectEditing.js' {
  /** What a provider's `activate` hands the text box. */
  export interface DirectEditingContext {
    text: string;
    /** In the canvas container's pixel coordinates. */
    bounds: { x: number; y: number; width: number; height: number };
    style?: Record<string, string>;
    options?: { centerVertically?: boolean; autoResize?: boolean; resizable?: boolean };
  }

  export interface DirectEditingProvider {
    activate(element: unknown): DirectEditingContext | null | undefined;
    update(element: unknown, newText: string, oldText: string, bounds: unknown): void;
  }

  export default class DirectEditing {
    static $inject: string[];
    constructor(eventBus: unknown, canvas: unknown);
    registerProvider(provider: DirectEditingProvider): void;
    isActive(element?: unknown): boolean;
    activate(element: unknown): boolean;
    complete(): void;
    cancel(): void;
    getValue(): string;
  }
}
