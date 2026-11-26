/**
 * A loader while something large opens (Req 11.13): a spinner and what is opening, over the workspace.
 *
 * Opening a model, or drawing a large view, holds the page's main thread for up to seconds, and the browser paints
 * nothing meanwhile. So the loader is put on the page and painted first ({@link nextPaint}), and the work starts
 * after. Its spinner turns by a CSS animation of `transform`, which the browser runs off the main thread, so it keeps
 * turning while the work holds it. It fades in after a quarter of a second, also off the main thread, so a quick open
 * never flashes it.
 */

/** Wait until what is on the page now has been painted: the next frame, then past it. */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });
}

export class BusyIndicator {
  private open = 0;
  private overlay: HTMLElement | undefined;

  constructor(private readonly doc: Document = document) {}

  /** Whether it is shown. */
  get shown(): boolean {
    return this.overlay !== undefined;
  }

  /**
   * Run `work` under the loader, saying `message`: shown and painted first, gone once the work is done or failed.
   * Loaders asked for while one is shown share it, which says the latest message.
   */
  async while<T>(message: string, work: () => T | Promise<T>): Promise<T> {
    this.open++;
    this.render(message);
    try {
      await nextPaint();
      return await work();
    } finally {
      this.open--;
      if (this.open === 0) {
        this.overlay?.remove();
        this.overlay = undefined;
      }
    }
  }

  private render(message: string): void {
    if (!this.overlay) {
      const overlay = this.doc.createElement('div');
      overlay.className = 'la-busy';
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'polite');
      const card = this.doc.createElement('div');
      card.className = 'la-busy-card';
      const spinner = this.doc.createElement('span');
      spinner.className = 'la-busy-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      const text = this.doc.createElement('span');
      text.className = 'la-busy-text';
      card.append(spinner, text);
      overlay.append(card);
      this.doc.body.append(overlay);
      this.overlay = overlay;
    }
    this.overlay.querySelector('.la-busy-text')!.textContent = message;
  }
}
