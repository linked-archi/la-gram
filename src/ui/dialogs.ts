/**
 * Minimal modal dialogs: prompt, confirm, choose, info, and a transient toast.
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

/** The dialogs the UI needs. */
export interface Dialogs {
  /** Ask for a line of text; `null` when cancelled. */
  prompt(title: string, label: string, initial?: string): Promise<string | null>;
  /** Ask yes/no. `danger` styles the confirm button as destructive. */
  confirm(title: string, message: string, options?: { confirmLabel?: string; danger?: boolean; details?: string[] }): Promise<boolean>;
  /** Pick one of several options; `null` when cancelled. */
  choose(title: string, options: ChoiceOption[], initial?: string): Promise<string | null>;
  /** Show information (rows of text). */
  info(title: string, lines: string[]): Promise<void>;
  /** A short, non-blocking message. */
  toast(message: string, level?: 'info' | 'warning' | 'error'): void;
}

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
  buttons: Array<{ label: string; value: () => T; primary?: boolean; danger?: boolean }>,
  cancelValue: T,
  focus?: HTMLElement,
): Promise<T> {
  return new Promise<T>((resolve) => {
    const backdrop = el('div', { class: 'la-dialog-backdrop' });
    const dialog = el('div', { class: 'la-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
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
          close(primary.value());
        }
      }
    };
    for (const button of buttons) {
      const b = el('button', {
        class: `la-button${button.primary ? ' primary' : ''}${button.danger ? ' danger' : ''}`,
        type: 'button',
        text: button.label,
      });
      b.addEventListener('click', () => close(button.value()));
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
    let group: string | undefined;
    for (const option of options) {
      if (option.group && option.group !== group) {
        group = option.group;
        list.append(el('div', { class: 'la-choice-group', text: group }));
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
    }
    return modal<string | null>(
      title,
      [list],
      [
        { label: 'Cancel', value: () => null },
        { label: 'OK', value: () => selected, primary: true },
      ],
      null,
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
