/**
 * Minimal modal dialogs: prompt, form, confirm, choose, info, and a transient toast.
 *
 * Plain DOM in the light tree (styled from `index.html`), promise-based, and
 * behind an interface so `mount-ui` can be handed scripted answers in tests.
 * `window.prompt`/`confirm` would do functionally, but they block the event
 * loop, cannot show a list of affected views, and are unavailable in some
 * embedded webviews.
 */

/** One option of {@link Dialogs.choose}. */
export interface ChoiceOption {
  value: string;
  label: string;
  /** Secondary text under the label. */
  detail?: string;
  /** Section header the option is grouped under. */
  group?: string;
  disabled?: boolean;
}

/** One field of {@link Dialogs.form}. */
export interface FormField {
  name: string;
  label: string;
  /**
   * A line of text (default), a checkbox, a secret (typed unseen, never
   * pre-filled or autocompleted), one of `options` — or a section's heading
   * (`label`, with `hint` under it), or a group's within a section; neither has
   * a value.
   */
  type?: 'text' | 'checkbox' | 'password' | 'select' | 'section' | 'group';
  value?: string | boolean;
  /** Help shown under the field. */
  hint?: string;
  /** The choices of a `select`. */
  options?: Array<{ value: string; label: string }>;
  /** Shown, not offered for change: a value set elsewhere (a deployment's). */
  disabled?: boolean;
}

/** What {@link Dialogs.form} resolves with: text fields trimmed, checkboxes as booleans. */
export type FormValues = Record<string, string | boolean>;

/** A problem {@link FormOptions.validate} found: what it is, and where — a field's or a section's name. */
export interface FormProblem {
  message: string;
  field?: string;
}

/** Options of {@link Dialogs.form}. */
export interface FormOptions {
  /** A paragraph above the fields. */
  message?: string;
  confirmLabel?: string;
  /**
   * The problem with the values, shown in the dialog, or `null` to accept them.
   * One that names a field or a section opens its tab, marked.
   */
  validate?: (values: FormValues) => string | FormProblem | null;
  /** Each `section` field a tab of its own, listed down the side — for a form of several parts (Settings). */
  tabs?: boolean;
  /** With `tabs`: the section (by its field's name) to open first; the first otherwise. */
  openSection?: string;
}

/** The dialogs the UI needs. */
export interface Dialogs {
  /** Ask for a line of text; `null` when cancelled. */
  prompt(title: string, label: string, initial?: string): Promise<string | null>;
  /** Ask for several values at once; `null` when cancelled. */
  form(title: string, fields: FormField[], options?: FormOptions): Promise<FormValues | null>;
  /** Ask yes/no. `danger` styles the confirm button as destructive. */
  confirm(title: string, message: string, options?: { confirmLabel?: string; danger?: boolean; details?: string[] }): Promise<boolean>;
  /** Pick one of several options; `null` when cancelled. */
  choose(title: string, options: ChoiceOption[], initial?: string): Promise<string | null>;
  /** Show information (rows of text). */
  info(title: string, lines: string[]): Promise<void>;
  /** A short, non-blocking message. */
  toast(message: string, level?: 'info' | 'warning' | 'error'): void;
}

/** Options from which {@link Dialogs.choose} puts a filter over its list. */
const CHOICE_FILTER_FROM = 10;

/** Build a DOM element with attributes and children. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.append(child);
  return node;
}

/** Open a modal with a body and buttons; resolves with the button's value. */
function modal<T>(
  title: string,
  body: Node[],
  buttons: Array<{ label: string; value: () => T; primary?: boolean; danger?: boolean; accept?: () => boolean }>,
  cancelValue: T,
  focus?: HTMLElement,
  className = '',
): Promise<T> {
  return new Promise<T>((resolve) => {
    const backdrop = el('div', { class: 'la-dialog-backdrop' });
    const dialog = el('div', { class: `la-dialog${className ? ` ${className}` : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const footer = el('div', { class: 'la-dialog-footer' });
    let done = false;
    const close = (value: T) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(value);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(cancelValue);
      }
      if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
        const primary = buttons.find((b) => b.primary);
        if (primary) {
          e.preventDefault();
          e.stopPropagation();
          if (!primary.accept || primary.accept()) close(primary.value());
        }
      }
    };
    for (const button of buttons) {
      const b = el('button', {
        class: `la-button${button.primary ? ' primary' : ''}${button.danger ? ' danger' : ''}`,
        type: 'button',
        text: button.label,
      });
      b.addEventListener('click', () => {
        if (!button.accept || button.accept()) close(button.value());
      });
      footer.append(b);
    }
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close(cancelValue);
    });
    dialog.append(el('div', { class: 'la-dialog-title', text: title }), el('div', { class: 'la-dialog-body' }, ...body), footer);
    backdrop.append(dialog);
    document.body.append(backdrop);
    document.addEventListener('keydown', onKey, true);
    (focus ?? footer.querySelector<HTMLButtonElement>('.primary'))?.focus();
  });
}

/** The DOM implementation. */
export const domDialogs: Dialogs = {
  prompt(title, label, initial = '') {
    const input = el('input', { class: 'la-input', type: 'text', 'aria-label': label });
    input.value = initial;
    queueMicrotask(() => input.select());
    return modal<string | null>(
      title,
      [el('label', { class: 'la-dialog-label', text: label }), input],
      [
        { label: 'Cancel', value: () => null },
        { label: 'OK', value: () => input.value.trim() || null, primary: true },
      ],
      null,
      input,
    );
  },

  form(title, fields, options = {}) {
    const body: Node[] = [];
    if (options.message) body.push(el('p', { text: options.message }));
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();

    /** One field's row; its input is kept by name. */
    const row = (field: FormField): HTMLElement => {
      const id = `la-form-${field.name}`;
      const line = el('div', { class: `la-form-row${field.type === 'checkbox' ? ' check' : ''}${field.disabled ? ' fixed' : ''}` });
      if (field.type === 'select') {
        const select = el('select', { id, name: field.name, class: 'la-input', 'aria-label': field.label });
        for (const option of field.options ?? []) select.append(el('option', { value: option.value, text: option.label }));
        if (typeof field.value === 'string') select.value = field.value;
        select.disabled = field.disabled === true;
        line.append(el('label', { class: 'la-dialog-label', for: id, text: field.label }), select);
        if (field.hint) line.append(el('div', { class: 'la-dialog-hint', text: field.hint }));
        inputs.set(field.name, select);
        return line;
      }
      const type = field.type === 'checkbox' ? 'checkbox' : field.type === 'password' ? 'password' : 'text';
      const input = el('input', { id, name: field.name, type });
      input.disabled = field.disabled === true;
      if (field.type === 'password') {
        // Not remembered by the browser's autofill, nor offered back.
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('spellcheck', 'false');
      }
      if (field.type === 'checkbox') {
        input.checked = field.value === true;
        line.append(input, el('label', { for: id, text: field.label }));
      } else {
        input.className = 'la-input';
        input.value = typeof field.value === 'string' && field.type !== 'password' ? field.value : '';
        input.setAttribute('aria-label', field.label);
        line.append(el('label', { class: 'la-dialog-label', for: id, text: field.label }), input);
      }
      if (field.hint) line.append(el('div', { class: 'la-dialog-hint', text: field.hint }));
      inputs.set(field.name, input);
      return line;
    };

    /**
     * A group's heading — with All and None, when its fields are switches — and
     * the box its fields go in, two columns of switches.
     */
    const group = (field: FormField, members: () => HTMLInputElement[]): { head: HTMLElement; box: HTMLElement } => {
      const head = el('div', { class: 'la-form-group' }, el('span', { text: field.label }));
      const box = el('div', { class: 'la-form-group-body' });
      for (const [label, checked] of [['All', true], ['None', false]] as const) {
        const button = el('button', { type: 'button', class: 'la-form-group-all', text: label, title: `${checked ? 'Tick' : 'Untick'} all in ${field.label}` });
        button.addEventListener('click', () => {
          for (const input of members()) if (!input.disabled) input.checked = checked;
        });
        head.append(button);
      }
      return { head, box };
    };

    // Lay the fields out: sections (tabs, or headed parts), groups within them.
    interface Tab { name: string; button: HTMLButtonElement; pane: HTMLElement }
    const tabs: Tab[] = [];
    const tabOf = new Map<string, Tab>();
    let target: { append(...nodes: Node[]): void } = { append: (...nodes: Node[]) => body.push(...nodes) };
    let section: HTMLElement | undefined;
    let tab: Tab | undefined;
    const tabList = el('div', { class: 'la-form-tabs', role: 'tablist', 'aria-orientation': 'vertical' });
    const panes = el('div', { class: 'la-form-panes' });
    for (const field of fields) {
      if (field.type === 'section') {
        if (options.tabs) {
          const button = el('button', { type: 'button', class: 'la-form-tab', role: 'tab', 'data-section': field.name, text: field.label });
          const pane = el('div', { class: 'la-form-pane', role: 'tabpanel', 'data-section': field.name });
          if (field.hint) pane.append(el('div', { class: 'la-dialog-hint la-form-pane-hint', text: field.hint }));
          tab = { name: field.name, button, pane };
          tabs.push(tab);
          tabList.append(button);
          panes.append(pane);
          section = pane;
        } else {
          const heading = el('div', { class: 'la-form-section' }, el('div', { class: 'la-form-section-title', text: field.label }));
          if (field.hint) heading.append(el('div', { class: 'la-dialog-hint', text: field.hint }));
          body.push(heading);
          section = undefined;
        }
        tabOf.set(field.name, tab as Tab);
        target = section ?? { append: (...nodes: Node[]) => body.push(...nodes) };
        continue;
      }
      if (field.type === 'group') {
        const names: string[] = [];
        const { head, box } = group(field, () =>
          names.map((n) => inputs.get(n)).filter((i): i is HTMLInputElement => i instanceof HTMLInputElement && i.type === 'checkbox'),
        );
        (section ?? { append: (...nodes: Node[]) => body.push(...nodes) }).append(head, box);
        target = {
          append: (...nodes: Node[]) => {
            box.append(...nodes);
          },
        };
        // The group's fields are those that follow, until the next group or section.
        const at = fields.indexOf(field);
        for (const next of fields.slice(at + 1)) {
          if (next.type === 'group' || next.type === 'section') break;
          names.push(next.name);
        }
        continue;
      }
      if (tab) tabOf.set(field.name, tab);
      target.append(row(field));
    }

    const select = (chosen: Tab | undefined, focus = false): void => {
      for (const t of tabs) {
        const on = t === chosen;
        t.button.setAttribute('aria-selected', on ? 'true' : 'false');
        t.button.tabIndex = on ? 0 : -1;
        t.pane.hidden = !on;
      }
      if (focus) chosen?.button.focus();
    };
    if (options.tabs && tabs.length > 0) {
      tabs.forEach((t, i) => {
        t.button.addEventListener('click', () => select(t));
        t.button.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          select(tabs[(i + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length], true);
        });
      });
      body.push(el('div', { class: 'la-form-tabbed' }, tabList, panes));
      select(tabs.find((t) => t.name === options.openSection) ?? tabs[0]);
    }

    const error = el('div', { class: 'la-dialog-error', role: 'alert' });
    error.hidden = true;
    body.push(error);
    const values = (): FormValues => {
      const out: FormValues = {};
      for (const field of fields) {
        const input = inputs.get(field.name);
        if (!input) continue; // a section's or a group's heading
        out[field.name] = field.type === 'checkbox' ? (input as HTMLInputElement).checked : input.value.trim();
      }
      return out;
    };
    const opened = options.tabs ? tabs.find((t) => t.name === options.openSection) ?? tabs[0] : undefined;
    const first = [...inputs.entries()].find(
      ([name, i]) =>
        i instanceof HTMLInputElement && !i.disabled && (i.type === 'text' || i.type === 'password') && (!opened || tabOf.get(name) === opened),
    )?.[1] as HTMLInputElement | undefined;
    if (first) queueMicrotask(() => first.select());
    return modal<FormValues | null>(
      title,
      body,
      [
        { label: 'Cancel', value: () => null },
        {
          label: options.confirmLabel ?? 'OK',
          value: values,
          primary: true,
          accept: () => {
            const found = options.validate?.(values()) ?? null;
            const problem = typeof found === 'string' ? { message: found } : found;
            error.textContent = problem?.message ?? '';
            error.hidden = !problem;
            // A problem in a tab: that tab, marked, and the field in it.
            for (const t of tabs) t.button.classList.remove('invalid');
            const where = problem?.field ? tabOf.get(problem.field) : undefined;
            if (where) {
              where.button.classList.add('invalid');
              select(where);
              const input = problem?.field ? inputs.get(problem.field) : undefined;
              input?.focus();
            }
            return !problem;
          },
        },
      ],
      null,
      first ?? opened?.button,
      options.tabs && tabs.length > 0 ? 'la-dialog-tabbed' : '',
    );
  },

  confirm(title, message, options = {}) {
    const body: Node[] = [el('p', { text: message })];
    if (options.details && options.details.length > 0) {
      body.push(el('ul', { class: 'la-dialog-list' }, ...options.details.map((d) => el('li', { text: d }))));
    }
    return modal<boolean>(
      title,
      body,
      [
        { label: 'Cancel', value: () => false },
        { label: options.confirmLabel ?? 'OK', value: () => true, primary: true, danger: options.danger },
      ],
      false,
    );
  },

  choose(title, options, initial) {
    let selected = initial ?? options.find((o) => !o.disabled)?.value ?? null;
    const list = el('div', { class: 'la-choice-list', role: 'listbox' });
    /** Each group's header and its rows, for the filter to hide a group left empty. */
    const groups: Array<{ header?: HTMLElement; rows: Array<{ row: HTMLElement; text: string }> }> = [{ rows: [] }];
    let group: string | undefined;
    for (const option of options) {
      if (option.group && option.group !== group) {
        group = option.group;
        const header = el('div', { class: 'la-choice-group', text: group });
        list.append(header);
        groups.push({ header, rows: [] });
      }
      const row = el('div', {
        class: `la-choice${option.value === selected ? ' selected' : ''}${option.disabled ? ' disabled' : ''}`,
        role: 'option',
        'data-value': option.value,
      });
      row.append(el('div', { class: 'la-choice-label', text: option.label }));
      if (option.detail) row.append(el('div', { class: 'la-choice-detail', text: option.detail }));
      if (!option.disabled) {
        row.addEventListener('click', () => {
          selected = option.value;
          for (const r of list.querySelectorAll('.la-choice')) r.classList.toggle('selected', r === row);
        });
        row.addEventListener('dblclick', () => {
          selected = option.value;
          list.closest('.la-dialog')?.querySelector<HTMLButtonElement>('.primary')?.click();
        });
      }
      list.append(row);
      groups[groups.length - 1].rows.push({ row, text: `${option.label}\n${option.detail ?? ''}`.toLowerCase() });
    }
    // A long list — the model's folders, the viewpoints — gets a filter over it.
    let filter: HTMLInputElement | undefined;
    if (options.length > CHOICE_FILTER_FROM) {
      const input = el('input', { class: 'la-input la-choice-filter', type: 'search', placeholder: 'Filter…', 'aria-label': 'Filter' });
      input.addEventListener('input', () => {
        const query = input.value.trim().toLowerCase();
        for (const { header, rows } of groups) {
          for (const { row, text } of rows) row.hidden = query !== '' && !text.includes(query);
          if (header) header.hidden = rows.every(({ row }) => row.hidden);
        }
      });
      filter = input;
    }
    return modal<string | null>(
      title,
      filter ? [filter, list] : [list],
      [
        { label: 'Cancel', value: () => null },
        { label: 'OK', value: () => selected, primary: true },
      ],
      null,
      filter,
    );
  },

  info(title, lines) {
    return modal<void>(
      title,
      [el('div', { class: 'la-dialog-info' }, ...lines.map((l) => el('div', { text: l })))],
      [{ label: 'Close', value: () => undefined, primary: true }],
      undefined,
    );
  },

  toast(message, level = 'info') {
    let host = document.querySelector('.la-toasts');
    if (!host) {
      host = el('div', { class: 'la-toasts', 'aria-live': 'polite' });
      document.body.append(host);
    }
    const toast = el('div', { class: `la-toast ${level}`, text: message });
    host.append(toast);
    setTimeout(() => toast.remove(), level === 'error' ? 8000 : 4000);
  },
};
