/**
 * The Git tab reports checks without opening itself or interrupting editing. Its *Save to Git* is the File menu's
 * (Req 18.25): the `save` action, run by the module exactly as the menu runs it.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GitSyncStatus } from './git-sync.js';

@customElement('git-sync-status')
export class GitSyncPanel extends LitElement {
  @property({ attribute: false }) status?: GitSyncStatus;

  static override styles = css`
    :host { display: block; font: 13px sans-serif; color: #202124; padding: 12px; }
    .destination { font-weight: 600; overflow-wrap: anywhere; }
    .status { margin: 10px 0; }
    .status[data-phase='incoming'] { color: #1565c0; }
    .status[data-phase='error'], .status[data-phase='conflicts'] { color: #b34700; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 12px 0; }
    dt { color: #5f6368; } dd { margin: 0; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    button { font: inherit; padding: 5px 10px; background: white; border: 1px solid #aaa; border-radius: 3px; cursor: pointer; }
    button:disabled { opacity: .5; cursor: default; } button:focus-visible { outline: 2px solid #1565c0; outline-offset: 2px; }
  `;

  private action(action: string): void {
    this.dispatchEvent(new CustomEvent('git-sync-action', { detail: { action }, bubbles: true, composed: true }));
  }

  override render() {
    const s = this.status;
    if (!s) return nothing;
    const time = (value: number | undefined) => value === undefined ? '—' : new Date(value).toLocaleString();
    return html`
      <div class="destination">${s.where}</div>
      <p class="status" data-phase=${s.phase} role="status" aria-live="polite">${s.message}</p>
      <dl>
        <dt>Local changes</dt><dd>${s.local === undefined ? 'Not checked' : s.local ? 'Not saved to Git' : 'None'}</dd>
        <dt>Incoming changes</dt><dd>${s.incoming === undefined ? 'Not checked' : s.incoming ? 'Available' : 'None at last check'}</dd>
        <dt>Last checked</dt><dd>${time(s.lastChecked)}</dd>
        <dt>Regular checks</dt><dd>${s.intervalMinutes ? `Every ${s.intervalMinutes} ${s.intervalMinutes === 1 ? 'minute' : 'minutes'}` : 'Off'}</dd>
        <dt>Next check</dt><dd>${time(s.nextCheck)}</dd>
        <dt>Automatic pull</dt><dd>${s.autoPull ? 'Only when unchanged locally' : 'Off'}</dd>
        <dt>Auto-commit</dt><dd>${!s.autoCommit || s.autoCommit.mode === 'off' ? 'Off'
          : s.autoCommit.mode === 'idle' ? `After ${s.autoCommit.idleMinutes} ${s.autoCommit.idleMinutes === 1 ? 'minute' : 'minutes'} idle` : `Every ${s.autoCommit.intervalMinutes} minutes`}</dd>
        <dt>Next commit check</dt><dd>${time(s.nextCommit)}</dd>
        <dt>Last committed</dt><dd>${time(s.lastCommit)}</dd>
      </dl>
      <div class="actions">
        <button data-action="save" title=${s.where ? `Commit the model to ${s.where}, as File › Save to Git does` : 'Save to Git'}
          @click=${() => this.action('save')} ?disabled=${!s.canSave}>Save to Git</button>
        <button @click=${() => this.action('check')} ?disabled=${!s.canCheck}>Check for remote changes</button>
        <button @click=${() => this.action('pull')} ?disabled=${!s.canPull}>Pull from Git</button>
        <button @click=${() => this.action('settings')}>Git settings…</button>
        ${s.autoCommit && s.autoCommit.mode !== 'off' ? s.autoCommit.paused
          ? html`<button @click=${() => this.action('resume')} ?disabled=${!s.canResume}>Resume auto-commit</button>`
          : html`<button @click=${() => this.action('pause')}>Pause auto-commit</button>` : nothing}
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap { 'git-sync-status': GitSyncPanel; }
}
