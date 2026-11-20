/**
 * The toolbar menus' icons: 16 px line drawings in the text's colour, so they follow a disabled or a
 * highlighted entry. Drawn for la-gram; each is a few strokes on a 16 × 16 grid.
 */
import { html, svg, type SVGTemplateResult, type TemplateResult } from 'lit';

export type MenuIconName =
  | 'new'
  | 'open'
  | 'import'
  | 'save'
  | 'save-as'
  | 'git'
  | 'image'
  | 'copy'
  | 'model'
  | 'settings'
  | 'chevron';

const DRAWINGS: Record<MenuIconName, SVGTemplateResult> = {
  // A page with a corner folded, and a plus.
  new: svg`<path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5z"/><path d="M9 1.5v4h4M8 8v4M6 10h4"/>`,
  // A folder.
  open: svg`<path d="M1.5 4a1 1 0 0 1 1-1h3.5L7.5 4.5h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/>`,
  // An arrow down into a tray.
  import: svg`<path d="M8 1.5v8M5 6.5l3 3 3-3"/><path d="M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10"/>`,
  // A diskette.
  save: svg`<path d="M2.5 3a.5.5 0 0 1 .5-.5h8l2.5 2.5v8a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5z"/><path d="M5 2.5V6h5V2.5M4.5 13.5v-4h7v4"/>`,
  // A page with an arrow down: a file in another format.
  'save-as': svg`<path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5z"/><path d="M9 1.5v4h4M8 7.5v5M6 10.5l2 2 2-2"/>`,
  // Two branches joining.
  git: svg`<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5" r="1.5"/><path d="M4.5 5v6M11.5 6.5c0 2.5-2 4-5 4.5"/>`,
  // A framed picture: a sun and a hill.
  image: svg`<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><circle cx="5.5" cy="6" r="1.2"/><path d="M14.5 11l-4-4-8 6.5"/>`,
  // Two sheets, one over the other.
  copy: svg`<rect x="5.5" y="5.5" width="9" height="9" rx="1"/><path d="M3 10.5H2.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1V3"/>`,
  // A label: the model's name and namespace.
  model: svg`<path d="M1.5 8.6V2.5a1 1 0 0 1 1-1h6.1l6 6-7.1 7.1z"/><circle cx="5" cy="5" r="1"/>`,
  // Three sliders.
  settings: svg`<path d="M2 4h7M12 4h2M2 8h3M8 8h6M2 12h8M13 12h1"/><circle cx="10.5" cy="4" r="1.5"/><circle cx="6.5" cy="8" r="1.5"/><circle cx="11.5" cy="12" r="1.5"/>`,
  // A submenu's arrow.
  chevron: svg`<path d="M6 3.5l4.5 4.5L6 12.5"/>`,
};

/** The icon `name`, sized by the surrounding `.icon` box. */
export function menuIcon(name: MenuIconName): TemplateResult {
  return html`<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${DRAWINGS[name]}</svg>`;
}
