/**
 * A view's picture on the system clipboard, to paste straight into a document, a slide, a chat or a drawing
 * (Req 14.4).
 *
 * - **PNG**: an image (`image/png`), which every application that takes a pasted picture reads.
 * - **SVG**: the drawing as vector, `image/svg+xml` where the browser writes it, and always its markup as
 *   `text/plain`, which drawing tools and text editors read.
 *
 * The clipboard item is made at once, with the picture still being drawn — a promise per type — so the click
 * that asked for it still counts: Safari writes to the clipboard only within the user's gesture.
 */

/** The browser's clipboard, as far as this needs it; a fake in tests. */
export interface PictureClipboard {
  clipboard?: {
    write?(items: unknown[]): Promise<void>;
    writeText?(text: string): Promise<void>;
  };
  ClipboardItem?: {
    new (items: Record<string, Promise<Blob> | Blob>): unknown;
    supports?(type: string): boolean;
  };
}

function browserClipboard(): PictureClipboard {
  const g = globalThis as { navigator?: { clipboard?: PictureClipboard['clipboard'] }; ClipboardItem?: PictureClipboard['ClipboardItem'] };
  return { clipboard: g.navigator?.clipboard, ClipboardItem: g.ClipboardItem };
}

/** Why a picture cannot be copied here, in words; `undefined` when it can. */
export function pictureCopyProblem(format: 'svg' | 'png', env: PictureClipboard = browserClipboard()): string | undefined {
  if (!env.clipboard) return 'The clipboard is not available here.';
  if (format === 'png' && !(env.clipboard.write && env.ClipboardItem)) {
    return 'This browser cannot put a picture on the clipboard: export the view as PNG instead.';
  }
  if (format === 'svg' && !(env.clipboard.write && env.ClipboardItem) && !env.clipboard.writeText) {
    return 'This browser cannot write to the clipboard: export the view as SVG instead.';
  }
  return undefined;
}

/**
 * Put `picture` — the SVG's markup, or the PNG — on the clipboard. Call it in the click's own handler, before
 * awaiting anything; it rejects with the reason when the browser refuses.
 */
export async function copyPicture(
  format: 'svg' | 'png',
  picture: Promise<string | Blob>,
  env: PictureClipboard = browserClipboard(),
): Promise<void> {
  const problem = pictureCopyProblem(format, env);
  if (problem) throw new Error(problem);
  const { clipboard, ClipboardItem: Item } = env;
  if (format === 'png') {
    const png = picture.then((p) => (typeof p === 'string' ? new Blob([p], { type: 'image/png' }) : p));
    await clipboard!.write!([new Item!({ 'image/png': png })]);
    return;
  }
  const markup = picture.then((p) => (typeof p === 'string' ? p : p.text()));
  if (clipboard!.write && Item) {
    const types: Record<string, Promise<Blob>> = {
      'text/plain': markup.then((text) => new Blob([text], { type: 'text/plain' })),
    };
    if (Item.supports?.('image/svg+xml')) {
      types['image/svg+xml'] = markup.then((text) => new Blob([text], { type: 'image/svg+xml' }));
    }
    await clipboard!.write([new Item(types)]);
    return;
  }
  await clipboard!.writeText!(await markup);
}
