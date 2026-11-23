/**
 * A view's picture on the clipboard (Req 14.4): a PNG as an image, an SVG as vector where the browser writes it
 * and always as its markup; the item made before the picture is ready, so the click still counts.
 */
import { describe, it, expect } from 'vitest';
import { copyPicture, pictureCopyProblem, type PictureClipboard } from '../image-clipboard.js';

/** A clipboard that keeps what was written, each type's content read once it settles. */
function fakeClipboard(options: { svgImages?: boolean; noWrite?: boolean; noItem?: boolean } = {}) {
  const items: Array<Record<string, Promise<Blob> | Blob>> = [];
  const texts: string[] = [];
  class Item {
    constructor(readonly types: Record<string, Promise<Blob> | Blob>) {
      items.push(types);
    }
    static supports(type: string): boolean {
      return type !== 'image/svg+xml' || options.svgImages === true;
    }
  }
  const env: PictureClipboard = {
    clipboard: {
      ...(options.noWrite ? {} : { write: async (written: unknown[]) => void (await Promise.all(written.map((i) => Promise.all(Object.values((i as Item).types)))))}),
      writeText: async (text: string) => void texts.push(text),
    },
    ...(options.noItem ? {} : { ClipboardItem: Item }),
  };
  const read = async (index: number) =>
    Object.fromEntries(
      await Promise.all(Object.entries(items[index]!).map(async ([type, blob]) => [type, await (await blob).text()] as const)),
    );
  return { env, items, texts, read };
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';

describe('copying a view as a picture', () => {
  it('a PNG is an image, made into the item before it is drawn', async () => {
    const { env, items, read } = fakeClipboard();
    let draw!: (blob: Blob) => void;
    const png = new Promise<Blob>((resolve) => (draw = resolve));
    const copied = copyPicture('png', png, env);
    // The item is there before the picture: the click still counts.
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]!)).toEqual(['image/png']);
    draw(new Blob(['PNG'], { type: 'image/png' }));
    await copied;
    expect(await read(0)).toEqual({ 'image/png': 'PNG' });
  });

  it('an SVG is its markup, and vector too where the browser writes it', async () => {
    const markupOnly = fakeClipboard();
    await copyPicture('svg', Promise.resolve(SVG), markupOnly.env);
    expect(await markupOnly.read(0)).toEqual({ 'text/plain': SVG });

    const vector = fakeClipboard({ svgImages: true });
    await copyPicture('svg', Promise.resolve(SVG), vector.env);
    expect(await vector.read(0)).toEqual({ 'text/plain': SVG, 'image/svg+xml': SVG });
  });

  it('an SVG falls back to text where the browser writes no items', async () => {
    const { env, texts } = fakeClipboard({ noItem: true });
    await copyPicture('svg', Promise.resolve(SVG), env);
    expect(texts).toEqual([SVG]);
  });

  it('says why it cannot, and rejects with that', async () => {
    expect(pictureCopyProblem('png', {})).toBe('The clipboard is not available here.');
    const textOnly = fakeClipboard({ noWrite: true });
    expect(pictureCopyProblem('png', textOnly.env)).toBe(
      'This browser cannot put a picture on the clipboard: export the view as PNG instead.',
    );
    expect(pictureCopyProblem('svg', textOnly.env)).toBeUndefined();
    await expect(copyPicture('png', Promise.resolve(new Blob()), textOnly.env)).rejects.toThrow('export the view as PNG');
  });
});
