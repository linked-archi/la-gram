/**
 * The panes' frame (Req 24; `.agents/tasks/split-view/`): one pane, or two with a divider between them — side by
 * side, or one above the other. Dragged, the divider shares the room, neither pane under {@link MIN_SHARE} of it;
 * focused, ← → (↑ ↓) move it by {@link KEY_STEP}; a double-click shares it equally. The orientation, the divider's
 * place and *Sync selection* are remembered per browser.
 *
 * It knows nothing of views: mount-ui puts a pane's contents — its header, its canvas, its catalogue and matrix —
 * into the elements it is given.
 */

/** Left and right of a divider, or above and below one. */
export type SplitOrientation = 'side-by-side' | 'stacked';

/** The least share of the room a pane keeps. */
export const MIN_SHARE = 0.15;
/** How far an arrow key moves the divider. */
export const KEY_STEP = 0.05;

const ORIENTATION_KEY = 'la-gram:split-orientation';
const SHARE_KEY = 'la-gram:split-share';
const SYNC_SELECTION_KEY = 'la-gram:split-sync-selection';

const read = (key: string): string | null => {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const write = (key: string, value: string): void => {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* not remembered: fine */
  }
};

/** The orientation last used; side by side at first. */
export function rememberedOrientation(): SplitOrientation {
  return read(ORIENTATION_KEY) === 'stacked' ? 'stacked' : 'side-by-side';
}

/** The first pane's share of the room last left; a half at first. */
export function rememberedShare(): number {
  const value = Number(read(SHARE_KEY));
  return Number.isFinite(value) && value > 0 ? clampShare(value) : 0.5;
}

/** Whether the selection in the pane in use is outlined in the other (SV-8): on unless switched off. */
export function syncSelectionOn(): boolean {
  return read(SYNC_SELECTION_KEY) !== 'false';
}

export function rememberSyncSelection(on: boolean): void {
  write(SYNC_SELECTION_KEY, String(on));
}

/** A share within the bounds a pane keeps. */
export function clampShare(share: number): number {
  return Math.min(1 - MIN_SHARE, Math.max(MIN_SHARE, share));
}

export class SplitLayout {
  /** The frame: put where the one canvas was. */
  readonly element: HTMLElement;
  private readonly divider: HTMLElement;
  private panes: HTMLElement[];
  private orientation: SplitOrientation = rememberedOrientation();
  private share = rememberedShare();
  private dragging: number | undefined;

  constructor(first: HTMLElement, doc: Document = document) {
    this.element = doc.createElement('div');
    this.element.className = 'la-panes';
    this.divider = doc.createElement('div');
    this.divider.className = 'la-pane-divider';
    this.divider.setAttribute('role', 'separator');
    this.divider.setAttribute('aria-label', 'Divider between the panes');
    this.divider.setAttribute('aria-valuemin', String(MIN_SHARE * 100));
    this.divider.setAttribute('aria-valuemax', String((1 - MIN_SHARE) * 100));
    this.divider.tabIndex = 0;
    this.divider.title = 'Drag to share the room; double-click to share it equally';
    this.divider.addEventListener('pointerdown', this.onPointerDown);
    this.divider.addEventListener('pointermove', this.onPointerMove);
    this.divider.addEventListener('pointerup', this.onPointerUp);
    this.divider.addEventListener('pointercancel', this.onPointerUp);
    this.divider.addEventListener('dblclick', () => this.setShare(0.5, true));
    this.divider.addEventListener('keydown', this.onKey);
    this.panes = [first];
    this.render();
  }

  /** The orientation, split; nothing with one pane. */
  get split(): SplitOrientation | undefined {
    return this.panes.length === 2 ? this.orientation : undefined;
  }

  /** The first pane's share of the room. */
  get firstShare(): number {
    return this.share;
  }

  /** The panes, first (left or above) to last. */
  get all(): readonly HTMLElement[] {
    return this.panes;
  }

  /** Put a second pane after the first, as `orientation` says, remembered. */
  open(second: HTMLElement, orientation: SplitOrientation = this.orientation): void {
    if (this.panes.length === 1) this.panes = [this.panes[0]!, second];
    this.setOrientation(orientation);
  }

  /** Turn the panes: side by side, or one above the other — remembered. */
  setOrientation(orientation: SplitOrientation): void {
    this.orientation = orientation;
    write(ORIENTATION_KEY, orientation);
    this.render();
  }

  /** Take a pane out; the other fills the frame. */
  close(pane: HTMLElement): void {
    if (this.panes.length < 2 || !this.panes.includes(pane)) return;
    this.panes = this.panes.filter((p) => p !== pane);
    pane.remove();
    this.render();
  }

  /** Share the room: the first pane's part, kept within bounds; `remember`ed when the divider is let go. */
  setShare(share: number, remember = false): void {
    this.share = clampShare(share);
    if (remember) write(SHARE_KEY, String(this.share));
    this.applyShare();
  }

  private render(): void {
    const [first, second] = this.panes;
    this.element.dataset.split = second ? this.orientation : 'none';
    this.element.replaceChildren(...(second ? [first!, this.divider, second] : [first!]));
    this.divider.setAttribute('aria-orientation', this.orientation === 'side-by-side' ? 'vertical' : 'horizontal');
    this.divider.style.cursor = this.orientation === 'side-by-side' ? 'col-resize' : 'row-resize';
    this.applyShare();
  }

  private applyShare(): void {
    const [first, second] = this.panes;
    if (!first) return;
    if (second) {
      // The divider's width comes out of the first pane's part, so the two and it fill the frame exactly.
      first.style.flex = `0 0 calc(${(this.share * 100).toFixed(2)}% - 3px)`;
      second.style.flex = '1 1 0%';
    } else {
      first.style.flex = '1 1 auto';
    }
    this.divider.setAttribute('aria-valuenow', String(Math.round(this.share * 100)));
  }

  private shareAt(event: PointerEvent): number | undefined {
    const box = this.element.getBoundingClientRect();
    const size = this.orientation === 'side-by-side' ? box.width : box.height;
    if (!(size > 0)) return undefined;
    return (this.orientation === 'side-by-side' ? event.clientX - box.left : event.clientY - box.top) / size;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    this.dragging = event.pointerId;
    this.divider.setPointerCapture?.(event.pointerId);
    this.element.classList.add('la-panes-resizing');
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.dragging !== event.pointerId) return;
    const share = this.shareAt(event);
    if (share !== undefined) this.setShare(share);
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.dragging !== event.pointerId) return;
    this.dragging = undefined;
    this.divider.releasePointerCapture?.(event.pointerId);
    this.element.classList.remove('la-panes-resizing');
    this.setShare(this.share, true);
  };

  private onKey = (event: KeyboardEvent): void => {
    const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    const on = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    if (!back && !on) return;
    event.preventDefault();
    event.stopPropagation();
    this.setShare(this.share + (on ? KEY_STEP : -KEY_STEP), true);
  };
}
