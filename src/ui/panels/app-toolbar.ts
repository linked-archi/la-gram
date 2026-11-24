/**
 * App toolbar — the bar across the top.
 *
 * ```
 * [◭] la-gram ▾ │ Order Platform ● │ File ▾  Metamodels ▾ │ View: [Main ▾] [+] Viewpoint: [— ▾] │ Presentation: [Architect ▾] │ ◉ room · 2
 *
 * The icon and name open la-gram's own menu: About, the keyboard shortcuts, the
 * guides and la-gram's pages.
 * ```
 *
 * The File menu is in sections, each entry with its icon: opening; saving, with
 * *Save as ▸* holding the formats and a module's entries in its own submenu
 * (*Git ▸*); exporting the open view, to a file or to the clipboard; the settings.
 * A submenu opens on hover, on a click, or with → / Enter, and ← / Esc closes it.
 *
 * Purely presentational: every pick is a `toolbar-command` event
 * (`{ command, value? }`) that `mount-ui` executes. The state it shows is set
 * as properties by `mount-ui` whenever the model, the views or the loaded
 * metamodels change.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ViewInfo } from '@linked-archi/kernel/model-manager/interfaces.js';
import {
  CATALOGUE_KIND_LABELS,
  type CatalogueEntry,
} from '@linked-archi/kernel/metamodel-manager/catalogue.js';
import { MODEL_FORMATS } from '@linked-archi/kernel/import-export/model-io.js';
import { HELP_LINKS, helpHref, type HelpLink } from '../../help-links.js';
import { isMacPlatform, keyCombo } from '../help.js';
import { menuIcon, type MenuIconName } from './menu-icons.js';

/** Commands the toolbar can issue. */
export type ToolbarCommand =
  | 'new-model'
  | 'open-model'
  | 'save'
  | 'save-as'
  | 'save-no-geometry'
  | 'import-archimate'
  | 'export-svg'
  | 'export-png'
  /** The open view on the clipboard, as an SVG or a PNG (Req 14.4). */
  | 'copy-svg'
  | 'copy-png'
  | 'rename-model'
  | 'model-settings'
  | 'open-view'
  | 'view-back'
  | 'view-forward'
  | 'new-view'
  | 'set-viewpoint'
  | 'add-metamodel'
  | 'switch-metamodel'
  | 'unload-metamodel'
  | 'load-metamodel-iri'
  | 'upload-asset'
  | 'show-assets'
  | 'set-context'
  | 'share'
  | 'undo'
  | 'redo'
  | 'toggle-explorer'
  | 'toggle-palette'
  | 'toggle-rdf'
  /** A module's File-menu entry; the value is `<module>:<entry>`. */
  | 'module'
  /** File › Settings…: the modules' switches and each part's settings. */
  | 'settings'
  /** The Settings dialog, by its older name. */
  | 'modules'
  /** About la-gram, in la-gram's menu (under the name). */
  | 'about'
  /** Keyboard shortcuts, in la-gram's menu. */
  | 'shortcuts'
  /** Download the desktop app, in la-gram's menu: the latest release's, a link for each platform. */
  | 'download';

/** Detail of `toolbar-command`. */
export interface ToolbarCommandDetail {
  command: ToolbarCommand;
  value?: string;
}

/** An entry a module adds to the File menu (`MountedUi.addFileMenu`). */
export interface FileMenuItem {
  /** `<module>:<entry>`, the value of the `module` command. */
  command: string;
  label: string;
  hint?: string;
  /** Beside Open (`open`) or beside Save (`save`). */
  section: 'open' | 'save';
  /** The submenu it is in, after Save; with none, it is in its section. */
  submenu?: FileSubmenu;
}

/** A module's submenu of the File menu: its entries, `open` ones first. */
export interface FileSubmenu {
  id: string;
  label: string;
  icon?: MenuIconName;
}

/** A labelled IRI for a selector. */
export interface LabelledIri {
  iri: string;
  label: string;
}

/** Collaboration state as the toolbar shows it. */
export interface CollabIndicator {
  status: 'off' | 'connecting' | 'connected' | 'disconnected';
  room?: string;
  peers: Array<{ name: string; color: string }>;
}

@customElement('app-toolbar')
export class AppToolbar extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: 6px;
      height: 40px;
      padding: 0 10px;
      background: #fff;
      border-bottom: 1px solid #dadce0;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      font-size: 13px;
      box-sizing: border-box;
      position: relative;
      z-index: 20;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 0;
      background: none;
      padding: 3px 6px 3px 2px;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
      color: #1a73e8;
      letter-spacing: 0.02em;
      white-space: nowrap;
      flex: none;
    }
    .brand:hover,
    .brand.open {
      background: #f1f3f4;
    }
    .brand .caret {
      font-weight: 400;
      color: #3c4043;
    }
    .brand img {
      width: 20px;
      height: 20px;
      display: block;
    }
    .sep {
      width: 1px;
      height: 22px;
      background: #e0e0e0;
      margin: 0 4px;
    }
    .model-name {
      flex: 0 1 auto;
      min-width: 64px;
      border: 0;
      background: none;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 4px;
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .model-name:hover {
      background: #f1f3f4;
    }
    .dirty {
      color: #e37400;
      margin-left: 2px;
    }
    .menu-wrap {
      position: relative;
      flex: none;
    }
    /* Menus, buttons and toggles keep their size and stay on one line; when the
       bar is short of room, the model's name and the selectors give way. */
    button.menu-button,
    button.icon,
    button.toggle {
      white-space: nowrap;
      flex: none;
    }
    button.menu-button,
    button.icon {
      border: 1px solid transparent;
      background: none;
      font: inherit;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      color: #3c4043;
    }
    button.menu-button:hover,
    button.icon:hover,
    button.menu-button.open {
      background: #f1f3f4;
    }
    button.icon:disabled {
      color: #bdc1c6;
      background: none;
      cursor: default;
    }
    .dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 2px;
      background: #fff;
      border: 1px solid #dadce0;
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
      padding: 4px 0;
      min-width: 240px;
      max-height: 70vh;
      overflow: auto;
    }
    .dropdown button {
      display: flex;
      justify-content: space-between;
      width: 100%;
      text-align: left;
      border: 0;
      background: none;
      padding: 6px 14px;
      font: inherit;
      cursor: pointer;
      gap: 12px;
    }
    .dropdown button:hover,
    .dropdown a:hover {
      background: #eef3fd;
    }
    /* A page la-gram's menu opens: as an entry, marked as leaving the app. */
    .dropdown a {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 14px;
      color: inherit;
      text-decoration: none;
    }
    .dropdown a .hint {
      flex: none;
    }
    .dropdown a {
      white-space: nowrap;
    }
    .dropdown button:disabled {
      color: #9aa0a6;
      cursor: default;
      background: none;
    }
    .dropdown .group {
      padding: 6px 14px 2px;
      font-size: 11px;
      font-weight: 600;
      color: #5f6368;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .dropdown hr {
      border: 0;
      border-top: 1px solid #eee;
      margin: 4px 0;
    }
    .hint {
      color: #80868b;
      font-size: 11px;
    }
    /* The File menu: an icon, the entry, its hint and its keys; submenus beside it, so it does not scroll. */
    .dropdown.file {
      overflow: visible;
      max-height: none;
      min-width: 270px;
    }
    .dropdown button.item {
      justify-content: flex-start;
      align-items: center;
      gap: 10px;
    }
    .item .icon,
    .item .chevron {
      flex: none;
      display: inline-flex;
      width: 16px;
      height: 16px;
      color: #5f6368;
    }
    .item .chevron {
      color: #9aa0a6;
      margin-left: auto;
    }
    .item .label {
      flex: 1 1 auto;
      white-space: nowrap;
    }
    .item .hint,
    .item kbd {
      flex: none;
    }
    .item kbd {
      font: inherit;
      font-size: 11px;
      color: #5f6368;
      min-width: 40px;
      text-align: right;
    }
    .dropdown button.item:hover .icon,
    .dropdown button.item.open .icon {
      color: #1a73e8;
    }
    .dropdown button.item.open {
      background: #eef3fd;
    }
    .sub-wrap {
      position: relative;
    }
    .dropdown.submenu {
      top: -5px;
      left: 100%;
      margin: 0 0 0 2px;
      min-width: 230px;
    }
    label.field {
      display: flex;
      align-items: center;
      gap: 4px;
      color: #5f6368;
      white-space: nowrap;
      flex: none;
    }
    /* A narrower window, narrower selectors; then the selectors without their
       names, then the panel toggles without their words (each says it on
       hover) — so the bar holds everything down to 1100 px. */
    @media (max-width: 1680px) {
      label.field select {
        max-width: 150px;
      }
    }
    @media (max-width: 1500px) {
      .field-name {
        display: none;
      }
    }
    @media (max-width: 1340px) {
      .toggle-name {
        display: none;
      }
      label.field select {
        max-width: 120px;
      }
    }
    @media (max-width: 1150px) {
      label.field select {
        max-width: 96px;
      }
    }
    select {
      font: inherit;
      padding: 2px 4px;
      border: 1px solid #dadce0;
      border-radius: 4px;
      max-width: 200px;
      background: #fff;
    }
    .spacer {
      flex: 1 1 auto;
    }
    button.toggle {
      border: 1px solid #dadce0;
      background: #fff;
      font: inherit;
      font-size: 12px;
      padding: 3px 10px;
      border-radius: 4px;
      cursor: pointer;
      color: #3c4043;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    button.toggle:hover {
      background: #f1f3f4;
    }
    button.toggle[aria-pressed='true'] {
      background: #e8f0fe;
      border-color: #1a73e8;
      color: #1a73e8;
    }
    .collab {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #5f6368;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 4px;
    }
    .collab:hover {
      background: #f1f3f4;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #9aa0a6;
    }
    .dot.connected {
      background: #188038;
    }
    .dot.connecting {
      background: #f9ab00;
    }
    .dot.disconnected {
      background: #d93025;
    }
    .peer {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-left: -4px;
      border: 2px solid #fff;
    }
  `;

  @property({ type: String }) modelLabel = 'Untitled model';
  @property({ type: Boolean }) dirty = false;
  @property({ attribute: false }) views: ViewInfo[] = [];
  @property({ type: String }) activeViewIri = '';
  /** The view Back would go to, by name; empty when there is none. */
  @property({ type: String }) backLabel = '';
  /** The view Forward would go to, by name; empty when there is none. */
  @property({ type: String }) forwardLabel = '';
  @property({ attribute: false }) viewpoints: LabelledIri[] = [];
  @property({ type: String }) activeViewpointIri = '';
  @property({ attribute: false }) loadedMetamodels: LabelledIri[] = [];
  @property({ attribute: false }) catalogue: readonly CatalogueEntry[] = [];
  /** Catalogue entries not offered in the Metamodels menu (File › Settings… › Metamodels); a loaded one is listed anyway. */
  @property({ attribute: false }) hiddenCatalogue: ReadonlySet<string> = new Set();
  @property({ attribute: false }) presentationContexts: LabelledIri[] = [];
  @property({ type: String }) activeContextIri = '';
  @property({ attribute: false }) collab: CollabIndicator = { status: 'off', peers: [] };
  /** Whether the RDF panel is shown (the toggle's pressed state). */
  @property({ type: Boolean }) rdfOpen = false;
  /** Whether the palette is shown (the "Palette" toggle is pressed). */
  @property({ type: Boolean }) paletteOpen = true;
  /** Whether the model tree is shown (the "Model" toggle is pressed). */
  @property({ type: Boolean }) explorerOpen = true;
  /** The modules' File-menu entries, asked each time the menu opens. */
  @property({ attribute: false }) fileMenuItems: () => FileMenuItem[] = () => [];
  /** Whether File › Settings… is offered: there is a module to switch, or a part with settings. */
  @property({ type: Boolean }) settingsMenu = false;
  /** The channel la-gram is built for (`alpha`), whose documentation its menu opens; empty for a release. */
  @property({ type: String }) channel = '';

  @state() private _open: 'file' | 'metamodels' | 'new-view' | 'app' | null = null;
  /** The File menu's open submenu, by id. */
  @state() private _sub: string | null = null;
  private _subTimer: ReturnType<typeof setTimeout> | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('mousedown', this._onOutside, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('mousedown', this._onOutside, true);
    clearTimeout(this._subTimer);
  }

  /**
   * Set each select's value after the options exist. A `.value` binding is
   * evaluated before Lit renders a select's new options, so switching to a view
   * that was not an option a moment ago would leave the select blank.
   */
  override updated(): void {
    const set = (label: string, value: string) => {
      const select = this.renderRoot.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
      if (select && select.value !== value) select.value = value;
    };
    set('Open view', this.activeViewIri);
    set('Viewpoint of the open view', this.activeViewpointIri);
    set('Presentation context', this.activeContextIri);
  }

  private _onOutside = (e: MouseEvent): void => {
    if (!this._open) return;
    if (e.composedPath().includes(this)) return;
    this._open = null;
    this._sub = null;
  };

  private _cmd(command: ToolbarCommand, value?: string): void {
    this._open = null;
    this._sub = null;
    clearTimeout(this._subTimer);
    this.dispatchEvent(
      new CustomEvent<ToolbarCommandDetail>('toolbar-command', {
        detail: { command, ...(value !== undefined ? { value } : {}) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _toggle(menu: 'file' | 'metamodels' | 'new-view' | 'app'): void {
    this._open = this._open === menu ? null : menu;
    this._sub = null;
    clearTimeout(this._subTimer);
  }

  /** An entry of the File menu: its icon, its name, then what it saves as or its keys. */
  private _item(
    command: ToolbarCommand,
    icon: MenuIconName | undefined,
    label: string,
    options: { value?: string; hint?: string; keys?: string } = {},
  ) {
    return html`<button
      class="item"
      role="menuitem"
      data-command=${command}
      data-value=${options.value ?? nothing}
      @click=${() => this._cmd(command, options.value)}
    >
      <span class="icon">${icon ? menuIcon(icon) : nothing}</span><span class="label">${label}</span>${options.hint
        ? html`<span class="hint">${options.hint}</span>`
        : nothing}${options.keys ? html`<kbd>${options.keys}</kbd>` : nothing}
    </button>`;
  }

  /** A module's entry: its command is `<module>:<entry>`. */
  private _moduleItem(i: FileMenuItem, icon?: MenuIconName) {
    return html`<button
      class="item"
      role="menuitem"
      data-command="module"
      data-value=${i.command}
      @click=${() => this._cmd('module', i.command)}
    >
      <span class="icon">${icon ? menuIcon(icon) : nothing}</span><span class="label">${i.label}</span>${i.hint
        ? html`<span class="hint">${i.hint}</span>`
        : nothing}
    </button>`;
  }

  /** An entry that opens a submenu beside it. */
  private _submenu(id: string, icon: MenuIconName | undefined, label: string, content: unknown) {
    const open = this._sub === id;
    return html`<div class="sub-wrap" data-sub=${id}>
      <button
        class="item has-sub ${open ? 'open' : ''}"
        role="menuitem"
        data-submenu=${id}
        aria-haspopup="menu"
        aria-expanded=${open ? 'true' : 'false'}
        @click=${() => this._openSub(id)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key !== 'ArrowRight' && e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          void this._openSub(id, true);
        }}
      >
        <span class="icon">${icon ? menuIcon(icon) : nothing}</span><span class="label">${label}</span
        ><span class="chevron">${menuIcon('chevron')}</span>
      </button>
      ${open
        ? html`<div class="dropdown submenu" role="menu" @keydown=${(e: KeyboardEvent) => this._subKey(e, id)}>${content}</div>`
        : nothing}
    </div>`;
  }

  /** Open a submenu; from the keyboard, with its first entry focused. */
  private async _openSub(id: string, focus = false): Promise<void> {
    clearTimeout(this._subTimer);
    this._sub = id;
    if (!focus) return;
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>(`.sub-wrap[data-sub="${id}"] .submenu button:not(:disabled)`)?.focus();
  }

  /** ← or Esc in a submenu: closed, its entry focused again. */
  private _subKey(e: KeyboardEvent, id: string): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    this._sub = null;
    this.renderRoot.querySelector<HTMLElement>(`button[data-submenu="${id}"]`)?.focus();
  }

  /**
   * The pointer over the File menu: the submenu of the entry under it opens at once when none is open; another
   * replaces it, or none closes it, after a moment, so that crossing an entry on the way to an open submenu
   * leaves it open.
   */
  private _onMenuHover = (e: MouseEvent): void => {
    const wrap = e
      .composedPath()
      .find((n): n is HTMLElement => n instanceof HTMLElement && n.classList.contains('sub-wrap'));
    const id = wrap?.dataset['sub'] ?? null;
    clearTimeout(this._subTimer);
    if (id === this._sub) return;
    if (this._sub === null) {
      this._sub = id;
      return;
    }
    this._subTimer = setTimeout(() => (this._sub = id), 250);
  };

  private _fileMenu() {
    const items = this.fileMenuItems();
    const keys = (combo: string) => keyCombo(combo, isMacPlatform());
    const loose = (section: FileMenuItem['section']) =>
      items.filter((i) => !i.submenu && i.section === section).map((i) => this._moduleItem(i));
    // The modules' submenus, in the order their first entries come, each with its open entries first.
    const submenus = new Map<string, { menu: FileSubmenu; entries: FileMenuItem[] }>();
    for (const i of items) {
      if (!i.submenu) continue;
      const sub = submenus.get(i.submenu.id) ?? { menu: i.submenu, entries: [] };
      sub.entries.push(i);
      submenus.set(i.submenu.id, sub);
    }
    const moduleSubmenu = ({ menu, entries }: { menu: FileSubmenu; entries: FileMenuItem[] }) => {
      const opening = entries.filter((i) => i.section === 'open');
      const saving = entries.filter((i) => i.section === 'save');
      return this._submenu(
        `module-${menu.id}`,
        menu.icon,
        menu.label,
        html`${opening.map((i) => this._moduleItem(i, 'open'))}${opening.length > 0 && saving.length > 0
          ? html`<hr />`
          : nothing}${saving.map((i) => this._moduleItem(i))}`,
      );
    };
    return html`<div class="dropdown file" role="menu" @mouseover=${this._onMenuHover}>
      ${this._item('new-model', 'new', 'New model')}
      ${this._item('open-model', 'open', 'Open…', { keys: keys('Mod+O') })}
      ${this._item('import-archimate', 'import', 'Import ArchiMate exchange…', { hint: '.xml' })}
      ${loose('open')}
      <hr />
      ${this._item('save', 'save', 'Save', { hint: 'TriG', keys: keys('Mod+S') })}
      ${this._submenu(
        'save-as',
        'save-as',
        'Save as',
        html`${MODEL_FORMATS.map((f) =>
            this._item('save-as', undefined, f.label, { value: f.id, hint: `.${f.extension}` }),
          )}
          <hr />
          ${this._item('save-no-geometry', undefined, 'Turtle without diagram geometry', { hint: '.ttl' })}`,
      )}
      ${loose('save')} ${[...submenus.values()].map(moduleSubmenu)}
      <hr />
      ${this._submenu(
        'export',
        'image',
        'Export view',
        html`${this._item('export-svg', 'save-as', 'Save as SVG…', { hint: '.svg' })}
          ${this._item('export-png', 'save-as', 'Save as PNG…', { hint: '.png' })}
          <hr />
          ${this._item('copy-png', 'copy', 'Copy as PNG', { hint: 'paste as a picture' })}
          ${this._item('copy-svg', 'copy', 'Copy as SVG', { hint: 'vector, or its markup' })}`,
      )}
      <hr />
      ${this._item('model-settings', 'model', 'Model settings…', { hint: 'name, namespace' })}
      ${this.settingsMenu ? this._item('settings', 'settings', 'Settings…', { hint: 'modules, defaults' }) : nothing}
    </div>`;
  }

  private _metamodelMenu() {
    const loaded = new Set(this.loadedMetamodels.map((m) => m.iri));
    // What the settings leave in the menu; the loaded ones are listed above anyway.
    const offered = this.catalogue.filter((e) => !this.hiddenCatalogue.has(e.iri));
    const hidden = this.catalogue.length - offered.length;
    // The catalogue's sections that offer something, in this order.
    const kinds = (['core', 'language', 'framework', 'extension'] as const).filter((kind) =>
      offered.some((e) => e.kind === kind),
    );
    return html`<div class="dropdown" role="menu">
      <div class="group">Loaded</div>
      ${this.loadedMetamodels.length === 0
        ? html`<button disabled>None</button>`
        : this.loadedMetamodels.map(
            (m) => html`<button
              data-command="unload-metamodel"
              data-value=${m.iri}
              title="Unload ${m.label} (the model is kept)"
              @click=${() => this._cmd('unload-metamodel', m.iri)}
            >
              ✓ ${m.label} <span class="hint">unload</span>
            </button>`,
          )}
      ${kinds.map(
        (kind) => html`<div class="group">${CATALOGUE_KIND_LABELS[kind]}</div>
          ${offered
            .filter((e) => e.kind === kind)
            .map(
              (e) => html`<button
                data-command="add-metamodel"
                data-value=${e.iri}
                ?disabled=${loaded.has(e.iri)}
                title=${e.iri}
                @click=${() => this._cmd('add-metamodel', e.iri)}
              >
                ${e.label}
                <span class="hint"
                  >${loaded.has(e.iri)
                    ? 'loaded'
                    : html`<span
                        @click=${(ev: Event) => {
                          ev.stopPropagation();
                          this._cmd('switch-metamodel', e.iri);
                        }}
                        title="Replace the loaded metamodels with this one"
                        >switch to</span
                      > · add`}</span
                >
              </button>`,
            )}`,
      )}
      <hr />
      <button data-command="load-metamodel-iri" @click=${() => this._cmd('load-metamodel-iri')}>Load by IRI…</button>
      <button data-command="upload-asset" @click=${() => this._cmd('upload-asset')}>
        Upload metamodel or asset file…
      </button>
      <button data-command="show-assets" @click=${() => this._cmd('show-assets')}>Show loaded assets…</button>
      <button
        data-command="settings"
        data-value="metamodels"
        title="File › Settings… › Metamodels: which metamodels this menu offers"
        @click=${() => this._cmd('settings', 'metamodels')}
      >
        Choose which to show…${hidden > 0 ? html` <span class="hint">${hidden} hidden</span>` : nothing}
      </button>
    </div>`;
  }

  private _newViewMenu() {
    return html`<div class="dropdown" role="menu">
      <button data-command="new-view" data-value="Diagram" @click=${() => this._cmd('new-view', 'Diagram')}>New diagram</button>
      <button data-command="new-view" data-value="Catalog" @click=${() => this._cmd('new-view', 'Catalog')}>New catalog</button>
      <button data-command="new-view" data-value="Matrix" @click=${() => this._cmd('new-view', 'Matrix')}>New matrix</button>
    </div>`;
  }

  /** la-gram's menu, under its icon and name: About, the keyboard shortcuts, the guides, la-gram's own pages. */
  private _appMenu() {
    const link = (l: HelpLink) =>
      html`<a href=${helpHref(l, this.channel)} target="_blank" rel="noopener noreferrer" data-link=${l.id} role="menuitem" @click=${() => (this._open = null)}
        >${l.label}<span class="hint">↗</span></a
      >`;
    return html`<div class="dropdown" role="menu">
      <button data-command="about" role="menuitem" @click=${() => this._cmd('about')}>About la-gram</button>
      <button data-command="shortcuts" role="menuitem" @click=${() => this._cmd('shortcuts')}>Keyboard shortcuts</button>
      <hr />
      <div class="group">Guides</div>
      ${HELP_LINKS.filter((l) => l.group === 'guides').map(link)}
      <hr />
      <button data-command="download" role="menuitem" @click=${() => this._cmd('download')}>Download the desktop app…</button>
      ${HELP_LINKS.filter((l) => l.group === 'la-gram').map(link)}
    </div>`;
  }

  private _collab() {
    const c = this.collab;
    const title =
      c.status === 'off'
        ? 'Not shared — click to collaborate'
        : `Room "${c.room}" — ${c.status}, ${c.peers.length} other(s)`;
    return html`<div class="collab" title=${title} @click=${() => this._cmd('share')}>
      <span class="dot ${c.status}"></span>
      <span>${c.status === 'off' ? 'Share' : c.room}</span>
      ${c.peers.map(
        (p) => html`<span class="peer" style="background:${p.color}" title=${p.name}
          >${p.name.slice(0, 1).toUpperCase()}</span
        >`,
      )}
    </div>`;
  }

  override render() {
    return html`
      <div class="menu-wrap">
        <button
          class="brand ${this._open === 'app' ? 'open' : ''}"
          data-menu="app"
          title="la-gram: About, keyboard shortcuts, guides"
          aria-haspopup="menu"
          aria-expanded=${this._open === 'app' ? 'true' : 'false'}
          @click=${() => this._toggle('app')}
        >
          <img src="favicon.svg" alt="" />la-gram<span class="caret">▾</span>
        </button>
        ${this._open === 'app' ? this._appMenu() : nothing}
      </div>
      <span class="sep"></span>
      <button class="model-name" title="Model settings: name, namespace" @click=${() => this._cmd('model-settings')}>
        ${this.modelLabel}${this.dirty ? html`<span class="dirty" title="Unsaved changes">●</span>` : nothing}
      </button>
      <div class="menu-wrap">
        <button class="menu-button ${this._open === 'file' ? 'open' : ''}" data-menu="file" @click=${() => this._toggle('file')}>
          File ▾
        </button>
        ${this._open === 'file' ? this._fileMenu() : nothing}
      </div>
      <div class="menu-wrap">
        <button
          class="menu-button ${this._open === 'metamodels' ? 'open' : ''}"
          data-menu="metamodels"
          @click=${() => this._toggle('metamodels')}
        >
          Metamodels ▾
        </button>
        ${this._open === 'metamodels' ? this._metamodelMenu() : nothing}
      </div>
      <button class="icon" title="Undo (Ctrl+Z)" @click=${() => this._cmd('undo')}>↶</button>
      <button class="icon" title="Redo (Ctrl+Y)" @click=${() => this._cmd('redo')}>↷</button>
      <span class="sep"></span>
      <button
        class="icon"
        data-command="view-back"
        title=${this.backLabel ? `Back to ${this.backLabel} (Alt+←)` : 'Back (no earlier view)'}
        aria-label="Back to the previous view"
        ?disabled=${!this.backLabel}
        @click=${() => this._cmd('view-back')}
      >
        ←
      </button>
      <button
        class="icon"
        data-command="view-forward"
        title=${this.forwardLabel ? `Forward to ${this.forwardLabel} (Alt+→)` : 'Forward (no later view)'}
        aria-label="Forward to the next view"
        ?disabled=${!this.forwardLabel}
        @click=${() => this._cmd('view-forward')}
      >
        →
      </button>
      <label class="field" title="View"
        ><span class="field-name">View</span>
        <select
          aria-label="Open view"
          @change=${(e: Event) => this._cmd('open-view', (e.target as HTMLSelectElement).value)}
        >
          ${this.views.map(
            (v) => html`<option value=${v.iri} ?selected=${v.iri === this.activeViewIri}>
              ${v.label || 'Untitled'}${v.type !== 'Diagram' ? ` (${v.type.toLowerCase()})` : ''}
            </option>`,
          )}
        </select>
      </label>
      <div class="menu-wrap">
        <button class="icon" title="New view" data-menu="new-view" @click=${() => this._toggle('new-view')}>＋</button>
        ${this._open === 'new-view' ? this._newViewMenu() : nothing}
      </div>
      <label class="field" title="Viewpoint of the open view"
        ><span class="field-name">Viewpoint</span>
        <select
          aria-label="Viewpoint of the open view"
          @change=${(e: Event) => this._cmd('set-viewpoint', (e.target as HTMLSelectElement).value)}
        >
          <option value="" ?selected=${!this.activeViewpointIri}>— none —</option>
          ${this.viewpoints.map(
            (v) => html`<option value=${v.iri} ?selected=${v.iri === this.activeViewpointIri}>${v.label}</option>`,
          )}
        </select>
      </label>
      ${this.presentationContexts.length > 0
        ? html`<label class="field" title="Presentation: the audience the diagram is drawn for"
            ><span class="field-name">Presentation</span>
            <select
              aria-label="Presentation context"
              @change=${(e: Event) => this._cmd('set-context', (e.target as HTMLSelectElement).value)}
            >
              <option value="" ?selected=${!this.activeContextIri}>Default notation</option>
              ${this.presentationContexts.map(
                (c) => html`<option value=${c.iri} ?selected=${c.iri === this.activeContextIri}>${c.label}</option>`,
              )}
            </select>
          </label>`
        : nothing}
      <span class="spacer"></span>
      <button
        class="toggle"
        data-command="toggle-explorer"
        aria-pressed=${this.explorerOpen ? 'true' : 'false'}
        title=${this.explorerOpen ? 'Hide the model tree' : 'Show the model tree on the left'}
        @click=${() => this._cmd('toggle-explorer')}
      >
        ☰<span class="toggle-name"> Model</span>
      </button>
      <button
        class="toggle"
        data-command="toggle-palette"
        aria-pressed=${this.paletteOpen ? 'true' : 'false'}
        title=${this.paletteOpen ? 'Hide the palette' : 'Show the palette on the right'}
        @click=${() => this._cmd('toggle-palette')}
      >
        ▦<span class="toggle-name"> Palette</span>
      </button>
      <button
        class="toggle"
        data-command="toggle-rdf"
        aria-pressed=${this.rdfOpen ? 'true' : 'false'}
        title=${this.rdfOpen ? 'Hide the RDF panel' : 'Show the model as RDF (Turtle) on the right'}
        @click=${() => this._cmd('toggle-rdf')}
      >
        { }<span class="toggle-name"> RDF</span>
      </button>
      ${this._collab()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-toolbar': AppToolbar;
  }
}
