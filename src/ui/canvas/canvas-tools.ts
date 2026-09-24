/**
 * The canvas's global tools — the shared vocabulary between the toolbar that
 * offers them and the {@link import('./diagram-canvas.js').DiagramCanvas} that
 * activates them.
 *
 * Kept in its own module so neither side has to import the other: the toolbar is
 * a Lit component in `../panels`, the canvas is a plain class here, and both need
 * the same three ids, labels and glyphs.
 *
 * ## Why `toolManagerName` exists
 *
 * diagram-js's `ToolManager` announces the active tool on `tool-manager.update`
 * under the name the tool registered itself with — `'global-connect'`, `'lasso'`,
 * `'hand'` (see each feature's `toolManager.registerTool(...)` call). Those are
 * not the ids this app uses, so the mapping has to be written down somewhere; a
 * toolbar that guessed would simply never highlight the connect tool.
 */

/** A global canvas tool, as this app names them. */
export type CanvasTool = 'connect' | 'lasso' | 'hand';

/** Everything the toolbar and the canvas need to know about one tool. */
export interface CanvasToolInfo {
  tool: CanvasTool;
  /** Button label / tooltip. */
  title: string;
  /** Single-character glyph, so the toolbar needs no icon font. */
  glyph: string;
  /** The name diagram-js's `ToolManager` reports this tool under. */
  toolManagerName: string;
}

/** The tools, in toolbar order. */
export const CANVAS_TOOLS: ReadonlyArray<CanvasToolInfo> = [
  {
    tool: 'connect',
    title: 'Connect — click a source element, then a target',
    glyph: '\u2197',
    toolManagerName: 'global-connect',
  },
  { tool: 'lasso', title: 'Lasso select', glyph: '\u2b1a', toolManagerName: 'lasso' },
  { tool: 'hand', title: 'Pan the canvas', glyph: '\u270b', toolManagerName: 'hand' },
];

/** Resolve a `tool-manager.update` name back to this app's tool id. */
export function toolFromManagerName(name: string | null | undefined): CanvasTool | null {
  if (!name) return null;
  return CANVAS_TOOLS.find((info) => info.toolManagerName === name)?.tool ?? null;
}
