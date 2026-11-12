/**
 * Copy, cut, paste and duplicate on the canvas (copy-paste task, R1–R13, R15): what is selected becomes a
 * copy (`model-manager/clipboard.ts`), and a paste goes into the open diagram as one undoable step.
 *
 * ## The clipboard
 *
 * Ctrl/⌘+C, X and V — and the desktop app's Edit menu, which fires the same events — go through the
 * browser's `copy`, `cut` and `paste` events: the copy is written to their `DataTransfer` in la-gram's type
 * and as Turtle text, and read back from it. No permission is asked, and another la-gram window reads it. A
 * text field keeps its own keys, and Ctrl/⌘+C with text selected on the page copies that text.
 *
 * The forced modes (Ctrl/⌘+Shift+V, Ctrl/⌘+Alt+V), *Duplicate* (Ctrl/⌘+D) and the right-click menu are
 * not paste events, and a page cannot read the system clipboard without asking: they paste what this window
 * copied last — or last pasted from another window.
 *
 * ## Where
 *
 * At the pointer when it is over the diagram; otherwise where it was copied from, 20 px further right and
 * down for each paste of the same copy (R10). *Duplicate* is 20 px right and down of the original (R11).
 */

import {
  CLIPBOARD_MIME,
  copyConcepts,
  copyFromView,
  fragmentTurtle,
  pasteFragment,
  readFragment,
  unknownTypesIn,
  writeFragment,
  type ClipboardFragment,
  type PasteDeps,
  type PasteMode,
  type PasteResult,
} from '../../model-manager/clipboard.js';
import type { Point } from '../../model-manager/interfaces.js';
import type { PrefixMap } from '../../rdf-engine/interfaces.js';

/** How far each paste of the same copy, and a duplicate, moves from the original (R10, R11). */
export const PASTE_STEP = 20;

/** What the app gives the canvas's clipboard: where a copy comes from, and how to ask. */
export interface CanvasClipboardOptions {
  /** The open model's namespace, its metamodels and la-gram's version, for the copy's source. */
  source(): { namespace?: string; metamodelIris: string[]; version?: string };
  /** The prefixes the copy's Turtle is written with. */
  prefixes(): PrefixMap;
  /**
   * Into another model, elements of types no loaded metamodel defines: paste them as they are (`keep`) or
   * leave them out (`skip`); `null` cancels the paste. Without it, they are kept.
   */
  chooseUnknownTypes?(typeIris: string[]): Promise<'keep' | 'skip' | null>;
}

/** What the canvas does for its clipboard. */
export interface CanvasClipboardHost {
  /** The open diagram, its model and what a paste writes through; none when no diagram is open. */
  target(): { viewIri: string; modelIri: string; deps: PasteDeps } | undefined;
  /** The placements selected: nodes of elements and figures. */
  selectedPlacements(): string[];
  /** The pointer, in the diagram's coordinates, while it is over the diagram. */
  pointer(): Point | undefined;
  /** Run a change of the store as one undoable step; the diagram is drawn again from the store. */
  record(apply: () => void): boolean;
  /** Select these placements (nodes and links). */
  selectPlacements(iris: readonly string[]): void;
  /** Remove what is selected from the view, as *Delete from view* does. */
  removeSelectionFromView(): void;
  notice(message: string, level: 'info' | 'warning'): void;
  /** The size an element of a type is placed at — its notation's — for concepts pasted from the model tree. */
  sizeOf?(typeIri: string): { width: number; height: number } | undefined;
  /** The part of the diagram in sight, for concepts pasted from the model tree with the pointer elsewhere. */
  viewport?(): { x: number; y: number; width: number; height: number } | undefined;
}

/** Whether a key or clipboard event comes from a text field: the field's own. */
export function fromTextField(event: Event): boolean {
  const path = (event.composedPath?.() ?? []) as Array<{ tagName?: string; isContentEditable?: boolean }>;
  return path.some((node) => node.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName ?? ''));
}

/** Whether text is selected on the page: Ctrl/⌘+C copies it, not the diagram's selection. */
function textSelected(): boolean {
  return Boolean(globalThis.getSelection?.()?.toString());
}

export class CanvasClipboard {
  /** What this window copied last — or pasted last from another window — and how many times it was pasted. */
  private last: { fragment: ClipboardFragment; json: string; text: string; pastes: number } | undefined;

  /** Whether the last copy event was this clipboard's: a menu's copy goes through one where the browser fires it. */
  private handled = false;

  /** Concepts the model tree's *Copy* is copying, through the copy event it fires. */
  private pending: string[] | undefined;

  constructor(
    private readonly host: CanvasClipboardHost,
    private readonly options: CanvasClipboardOptions,
  ) {}

  /** Whether there is something to paste. */
  canPaste(): boolean {
    return this.last !== undefined;
  }

  /** What is selected, as a copy; none when no element or figure is selected. */
  private copySelection(): ClipboardFragment | undefined {
    const target = this.host.target();
    const nodes = this.host.selectedPlacements();
    if (!target || nodes.length === 0) return undefined;
    const source = { ...this.options.source(), modelIri: target.modelIri, viewIri: target.viewIri };
    return copyFromView(target.deps.store, target.deps.views, source, nodes);
  }

  /** Copy what is selected (R1, R3, R4): kept in this window, and written to `data`, a copy event's. */
  copy(data?: DataTransfer | null): boolean {
    const fragment = this.copySelection();
    if (!fragment) return false;
    const json = writeFragment(fragment);
    const text = fragmentTurtle(fragment, this.options.prefixes());
    this.last = { fragment, json, text, pastes: 0 };
    data?.setData(CLIPBOARD_MIME, json);
    data?.setData('text/plain', text);
    return true;
  }

  /** Copy concepts chosen in the model tree, without placements (R14): kept in this window, and written to `data`. */
  copyConcepts(iris: readonly string[], data?: DataTransfer | null): boolean {
    const target = this.host.target();
    if (!target || iris.length === 0) return false;
    const source = { ...this.options.source(), modelIri: target.modelIri };
    const fragment = copyConcepts(target.deps.store, source, iris);
    if (fragment.concepts.length === 0) return false;
    const json = writeFragment(fragment);
    const text = fragmentTurtle(fragment, this.options.prefixes());
    this.last = { fragment, json, text, pastes: 0 };
    data?.setData(CLIPBOARD_MIME, json);
    data?.setData('text/plain', text);
    return true;
  }

  /** The model tree's *Copy*: through the browser's copy event where it fires one, else in this window only. */
  copyConceptsFromMenu(iris: readonly string[]): boolean {
    this.pending = [...iris];
    this.handled = false;
    try {
      (globalThis.document as { execCommand?(command: string): boolean } | undefined)?.execCommand?.('copy');
    } catch {
      /* not offered: kept in this window */
    } finally {
      this.pending = undefined;
    }
    return this.handled || this.copyConcepts(iris);
  }

  /** Whether a copy event now is the model tree's *Copy*, whatever has the focus. */
  copyingConcepts(): boolean {
    return this.pending !== undefined;
  }

  /** Copy, then remove from the view (R2). */
  cut(data?: DataTransfer | null): boolean {
    if (!this.copy(data)) return false;
    this.host.removeSelectionFromView();
    return true;
  }

  /** The browser's `copy` or `cut` event: the diagram's selection, unless a field or selected text has it. */
  onCopyEvent(event: ClipboardEvent, cut = false): void {
    if (this.pending) {
      if (this.copyConcepts(this.pending, event.clipboardData)) {
        this.handled = true;
        event.preventDefault();
      }
      return;
    }
    if (fromTextField(event) || textSelected()) return;
    if (cut ? this.cut(event.clipboardData) : this.copy(event.clipboardData)) {
      this.handled = true;
      event.preventDefault();
    }
  }

  /**
   * Copy or cut from a menu: through the browser's copy event, where it fires one for the menu's click, so
   * the system clipboard has it too; otherwise in this window only.
   */
  copyFromMenu(cut = false): boolean {
    this.handled = false;
    try {
      (globalThis.document as { execCommand?(command: string): boolean } | undefined)?.execCommand?.(cut ? 'cut' : 'copy');
    } catch {
      /* not offered: kept in this window */
    }
    if (this.handled) return true;
    return cut ? this.cut() : this.copy();
  }

  /**
   * The browser's `paste` event (R5): la-gram's copy — from this window or another — pasted by the context.
   * Anything else on the clipboard is left to whatever else wants it.
   */
  onPasteEvent(event: ClipboardEvent): void {
    if (fromTextField(event) || !this.host.target()) return;
    const data = event.clipboardData;
    const json = data?.getData(CLIPBOARD_MIME) ?? '';
    const text = data?.getData('text/plain') ?? '';
    if (json) {
      if (json !== this.last?.json) {
        const fragment = readFragment(json);
        if (!fragment) return;
        this.last = { fragment, json, text, pastes: 0 };
      }
    } else if (!this.last || !text || text !== this.last.text) {
      return;
    }
    event.preventDefault();
    void this.paste('auto');
  }

  /** Paste what was copied last (R5, R6, R10, R12) — at `at`, a menu's place, or at the pointer. */
  async paste(mode: PasteMode, at: Point | undefined = this.host.pointer()): Promise<PasteResult | undefined> {
    const last = this.last;
    if (!this.host.target()) return undefined;
    if (!last) {
      this.host.notice('Nothing to paste: select elements on a diagram and copy them first.', 'info');
      return undefined;
    }
    const step = PASTE_STEP * (last.pastes + 1);
    // From the model tree, with the pointer elsewhere: in sight, a step further each time.
    const seen = last.fragment.nodes.length === 0 && !at ? this.host.viewport?.() : undefined;
    const where = at ? { at } : seen ? { at: { x: seen.x + 2 * PASTE_STEP + step, y: seen.y + 2 * PASTE_STEP + step } } : { offset: { x: step, y: step } };
    const result = await this.pasteInto(last.fragment, mode, where);
    if (result) last.pastes++;
    return result;
  }

  /** Duplicate what is selected: copies, in this view, 20 px right and down (R11). The clipboard is left as it is. */
  async duplicate(): Promise<PasteResult | undefined> {
    const fragment = this.copySelection();
    if (!fragment) return undefined;
    return this.pasteInto(fragment, 'copies', { offset: { x: PASTE_STEP, y: PASTE_STEP } });
  }

  private async pasteInto(
    fragment: ClipboardFragment,
    mode: PasteMode,
    position: { at: Point } | { offset: Point },
  ): Promise<PasteResult | undefined> {
    const asked = this.host.target();
    if (!asked) return undefined;
    let unknownTypes: 'keep' | 'skip' = 'keep';
    const unknown = unknownTypesIn(asked.deps.store, fragment, asked.modelIri);
    if (unknown.length > 0 && this.options.chooseUnknownTypes) {
      const answer = await this.options.chooseUnknownTypes(unknown);
      if (!answer) return undefined;
      unknownTypes = answer;
    }
    // Into the view open now: another may have been opened while la-gram asked.
    const target = this.host.target();
    if (!target || target.viewIri !== asked.viewIri) return undefined;
    let result: PasteResult | undefined;
    this.host.record(() => {
      result = pasteFragment(
        target.deps,
        fragment,
        { modelIri: target.modelIri, viewIri: target.viewIri },
        { mode, unknownTypes, ...position, ...(this.host.sizeOf ? { sizeOf: (type: string) => this.host.sizeOf!(type) } : {}) },
      );
    });
    if (!result) return undefined;
    this.host.selectPlacements([...result.nodes, ...result.links]);
    const { message, warning } = pasteMessage(result);
    this.host.notice(message, warning ? 'warning' : 'info');
    return result;
  }
}

/** "1 element", "4 relationships". */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "a", "a and b", "a, b and c". */
function sentence(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** What a paste says it did (R12), and whether it is a warning: something left out, or pasted otherwise than asked. */
export function pasteMessage(result: PasteResult): { message: string; warning: boolean } {
  const figures = result.nodes.length - result.elementsPlaced;
  const placed: string[] = [];
  if (result.mode === 'copies') {
    if (result.elementsPlaced > 0) placed.push(count(result.elementsPlaced, 'new element', 'new elements'));
    if (result.relationshipsPlaced > 0) placed.push(count(result.relationshipsPlaced, 'new relationship', 'new relationships'));
  } else {
    if (result.elementsPlaced > 0) placed.push(count(result.elementsPlaced, 'element', 'elements'));
    if (result.relationshipsPlaced > 0) placed.push(count(result.relationshipsPlaced, 'relationship', 'relationships'));
  }
  if (figures > 0) placed.push(count(figures, 'figure', 'figures'));

  const leftOut = result.notes.filter((n) => n.reason !== 'no-longer-in-model');
  const copiedInstead = result.notes.filter((n) => n.reason === 'no-longer-in-model').length;
  let message =
    placed.length === 0 ? 'Nothing pasted' : result.mode === 'copies' ? `Pasted ${sentence(placed)}` : `Placed ${sentence(placed)} again`;
  const more: string[] = [];
  if (result.propertiesLeftOut > 0) more.push(`${count(result.propertiesLeftOut, 'property', 'properties')} left out`);
  if (result.referencesImpossible) more.push('copied from another model, so pasted as new');
  if (copiedInstead > 0) more.push(`${copiedInstead} no longer in the model, pasted as new`);
  if (leftOut.length > 0) {
    const why = new Set(
      leftOut.map((n) =>
        n.reason === 'unknown-type'
          ? "of types this model's metamodels do not define"
          : n.reason === 'not-permitted'
            ? 'not permitted here'
            : 'with an end left out',
      ),
    );
    more.push(`${leftOut.length} left out: ${[...why].join('; ')}`);
  }
  if (more.length > 0) message += `; ${more.join('; ')}`;
  return { message: `${message}.`, warning: leftOut.length > 0 || copiedInstead > 0 || result.referencesImpossible };
}
