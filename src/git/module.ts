/**
 * Git storage — la-gram's first switchable module (Req 18.1).
 *
 * Imported only when it is on (`src/modules.ts`), into a chunk of its own; a
 * build with `LA_GRAM_GIT=off` leaves the chunk out. Started, it adds its
 * entries to the File menu, its section to File › Settings…, the bound file's
 * commits to the History tab (`git-history.ts`) — and, when a merge leaves
 * conflicts, its Conflicts tab (`merge-support.ts`); stopped, it takes them
 * away and forgets the session's tokens.
 */
import type { App } from '../app.js';
import type { MountedUi, BottomTabHandle } from '../ui/mount-ui.js';
import { isElectronEnvironment } from '../platform/platform-factory.js';
import { desktopBridge } from '../platform/desktop-bridge.js';
import { GitBindings } from './bindings.js';
import { DesktopTokenStore, WebTokenStore, type TokenStore } from './credentials.js';
import { GitError, setDesktop } from './errors.js';
import type { GitConfig } from '../config.js';
import { saveToGit, type GitSaveContext } from './git-save.js';
import { updateFromBranch } from './git-merge.js';
import { pullFromGit } from './git-pull.js';
import { GitSync } from './git-sync.js';
import { AutoCommitStore, AUTO_COMMIT_PREFIX } from './auto-commit-settings.js';
import { GitLocks, type GitLockResult } from './git-locks.js';
import { destinationKey } from './git-observation.js';
import './sync-panel.js';
import { openMergeRequest } from './git-review.js';
import { gitHistorySource, historyKey } from './git-history.js';
import type { HistoryGitSource } from '../ui/panels/history-panel.js';
import { startMerging } from './merge-support.js';
import { openFromGit, reopenFromGit, type GitOpenContext } from './git-open.js';
import { hostNotAllowed, type RepositoryLink } from './link.js';
import { HostKinds } from './host-kinds.js';
import { gitSettingsSection } from './settings-section.js';
import { PersonalSettings } from '../settings.js';
import type { PersonalGitSettings } from './git-save.js';
import { GitHubProvider } from './providers/github.js';
import { GitLabProvider } from './providers/gitlab.js';
import type { GitHostProvider } from './providers/provider.js';

/**
 * A provider for a repository — only on a host the deployment allows, when it
 * lists them: the flows refuse an address before this, and this is the last
 * check before a request.
 */
export function providerFor(link: RepositoryLink, token: string | undefined, config?: GitConfig): GitHostProvider {
  if (config?.hosts && !config.hosts.some((h) => h.host === link.host)) {
    throw new GitError('forbidden', hostNotAllowed(link.host, config.hosts));
  }
  return link.provider === 'github' ? new GitHubProvider(link, token) : new GitLabProvider(link, token);
}

/** The module, started. */
export interface GitStorage {
  /** Take the menu entries away and forget the session's tokens. */
  stop(): void;
  /** The Save flow's context (for tests and the console). */
  readonly context: GitSaveContext;
  /** The Open flow's context. */
  readonly openContext: GitOpenContext;
  readonly sync: GitSync;
}

/** Options for {@link startGitStorage}. */
export interface GitStorageOptions {
  /** A link to open once started (`?git=<link>`). */
  open?: string;
  /** The deployment's Git configuration (`la-gram.config.json`). */
  config?: GitConfig;
}

/** Start the module: its menu entries, its token store; open `options.open`. */
export async function startGitStorage(app: App, ui: MountedUi, options: GitStorageOptions = {}): Promise<GitStorage> {
  const desktop = isElectronEnvironment();
  setDesktop(desktop);
  const { config } = options;
  const remember = config?.rememberTokens !== 'never';
  const bridge = desktopBridge();
  const tokens: TokenStore = (bridge && (await DesktopTokenStore.create(bridge, remember))) || new WebTokenStore(undefined, remember);
  const provider = (link: RepositoryLink, token: string | undefined) => providerFor(link, token, config);
  const bindings = new GitBindings();
  const hostKinds = new HostKinds();
  const settings = new PersonalSettings();
  const autoCommits = new AutoCommitStore();
  const personal = (): PersonalGitSettings => settings.get<PersonalGitSettings>('git');
  // The user's "Remember starts ticked", where tokens may be remembered at all.
  const mine = personal().rememberByDefault;
  if (mine !== undefined && tokens.rememberLabel) tokens.rememberByDefault = mine;
  const { eventBus } = app.components;
  let generation = 0;
  let stopped = false;
  let running = false;
  let sync: GitSync | undefined;
  const locks = new GitLocks();
  const onLoaded = () => { generation++; sync?.modelLoaded(); };
  eventBus.on('model-loaded', onLoaded);

  const openContext: GitOpenContext = {
    dialogs: ui.dialogs,
    report: (message, level) => ui.report(message, level),
    tokens,
    bindings,
    provider,
    ...(config ? { config } : {}),
    personal,
    hostKinds,
    confirmReplace: (what) => ui.confirmReplace(what),
    open: async (text, fileName) => {
      await ui.openModelText(text, fileName);
      return app.session.modelIri;
    },
  };

  const merging = startMerging(app, ui);
  const context: GitSaveContext = {
    merge: { ...merging.support, replace: (snapshot) => {
      if (sync) sync.internalChange(() => merging.support.replace(snapshot));
      else merging.support.replace(snapshot);
    } },
    isDirty: () => app.isDirty(),
    words: { typeName: (iri) => ui.typeName(iri), propertyName: (p) => ui.propertyName(p) },
    review: (target) => openMergeRequest(context, target),
    reopen: (link, branch, path) => reopenFromGit(openContext, link, branch, path),
    modelIri: () => app.session.modelIri,
    modelLabel: () => app.session.modelLabel() || 'model',
    serialize: (format) => app.modelIO.serialize(app.session.modelIri, { format }),
    saved: (fileName) => eventBus.emit('model-saved', { fileName }),
    dialogs: ui.dialogs,
    report: (message, level) => ui.report(message, level),
    tokens,
    bindings,
    provider,
    ...(config ? { config } : {}),
    personal,
    hostKinds,
  };

  // File › Settings…: the defaults, the tokens kept, the host kinds learned.
  const removeSettings = ui.addSettingsSection(
    gitSettingsSection({ config, personal: settings, tokens, hostKinds, autoCommits,
      target: () => { const modelIri = context.modelIri(); const binding = modelIri ? bindings.get(modelIri) : undefined;
        return modelIri && binding ? { modelIri, binding } : undefined; },
      report: (message) => ui.report(message), changed: () => sync?.refresh(true) }),
  );

  // Shared by manual flows and scheduled checks; the owner lock never blocks manual work.
  const exclusive = async (operation: () => Promise<void>, automatic: boolean): Promise<GitLockResult<void>> => {
    if (running || stopped) return { ran: false, reason: 'busy' };
    running = true;
    const model = context.modelIri();
    const binding = model ? bindings.get(model) : undefined;
    try { return await locks.run(binding ? destinationKey(binding) : undefined, automatic, operation); }
    finally { running = false; sync?.refresh(); }
  };

  const run = async (id: string, address?: string): Promise<void> => {
    if (stopped) return;
    if (id === 'check') { syncTab?.show(); await sync?.check(); return; }
    if (id === 'settings') { await ui.runCommand({ command: 'settings', value: 'git' }); return; }
    if (id === 'pause') { sync?.pause(); return; }
    if (id === 'resume') { sync?.resume(); return; }
    const started = generation;
    const result = await exclusive(async () => {
      if (stopped || generation !== started) return;
      if (id === 'open') await openFromGit(openContext, address);
      else if (id === 'save' || id === 'save-as') {
        const saved = await saveToGit(context, id === 'save-as');
        if (saved && !stopped && generation === started) sync?.manualCommitted();
      }
      else if (id === 'pull') await pullFromGit({
        ...context,
        current: () => !stopped && generation === started,
        room: () => app.collaborationRoom,
        changed: () => sync?.internalChange(() => eventBus.emit('model-changed', { origin: 'git' })),
        pulled: (observed, dirty) => sync?.incorporated(observed, dirty),
      });
      else if (id === 'update') await updateFromBranch(context);
      else if (id === 'review') await openMergeRequest(context);
    }, false);
    if (!result.ran) ui.report('A Git operation is in progress. Wait for it to finish.', 'warning');
  };

  const syncPanel = document.createElement('git-sync-status');
  let syncTab: BottomTabHandle | undefined;
  sync = new GitSync({
    context: { ...context, current: () => !stopped, room: () => app.collaborationRoom,
      changed: () => sync?.internalChange(() => eventBus.emit('model-changed', { origin: 'git' })) },
    settings: personal, autoCommits, locks, run: exclusive, busy: () => running,
    visible: () => !document.hidden, online: () => navigator.onLine,
    publish: (status) => {
      syncPanel.status = status;
      if (status.where) {
        syncTab ??= ui.addBottomTab({ id: 'git-sync', label: 'Git', element: syncPanel });
        syncTab.setBadge(['error', 'conflicts'].includes(status.phase) ? '!' : ['checking', 'committing'].includes(status.phase) ? '…'
          : status.phase === 'paused' && (status.intervalMinutes || status.autoCommit?.mode !== 'off') ? 'Paused' : status.incoming ? 'New' : undefined);
      } else { syncTab?.remove(); syncTab = undefined; }
    },
  });
  const onSyncAction = (event: Event) => { void run((event as CustomEvent<{ action: string }>).detail.action); };
  syncPanel.addEventListener('git-sync-action', onSyncAction);
  const onEnvironment = () => sync?.refresh();
  const onSettingsStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === 'la-gram:settings' || event.key === 'la-gram:git-tokens' || event.key.startsWith(AUTO_COMMIT_PREFIX)) sync?.refresh(true);
  };
  const onSaved = () => { queueMicrotask(() => sync?.refresh()); };
  const onChange = () => sync?.modelChanged();
  eventBus.on('model-saved', onSaved);
  eventBus.on('collab-status', onEnvironment);
  eventBus.on('model-changed', onChange);
  const store = app.components.store as { subscribe?: (listener: () => void) => () => void };
  const unsubscribe = store.subscribe?.(onChange);
  document.addEventListener('visibilitychange', onEnvironment);
  window.addEventListener('online', onEnvironment);
  window.addEventListener('offline', onEnvironment);
  window.addEventListener('storage', onSettingsStorage);
  sync.refresh();

  const removeMenu = ui.addFileMenu(
    'git',
    () => {
      const modelIri = app.session.modelIri;
      const binding = modelIri ? bindings.get(modelIri) : undefined;
      return [
        { id: 'open', section: 'open' as const, label: 'Open from Git…', hint: 'GitHub, GitLab' },
        binding
          ? { id: 'save', section: 'save' as const, label: 'Save to Git', hint: `${binding.repository} · ${binding.branch}` }
          : { id: 'save', section: 'save' as const, label: 'Save to Git…', hint: 'GitHub, GitLab' },
        ...(binding ? [{ id: 'save-as', section: 'save' as const, label: 'Save to Git as…', hint: 'another branch or file' }] : []),
        ...(binding && !app.collaborationRoom ? [{ id: 'pull', section: 'save' as const, label: 'Pull from Git', hint: `${binding.repository} · ${binding.branch}` }] : []),
        ...(binding && !app.collaborationRoom ? [{ id: 'check', section: 'save' as const, label: 'Check for remote changes', hint: 'read without changing the model' }] : []),
        ...(binding ? [{ id: 'update', section: 'save' as const, label: 'Update from main…', hint: `merge another branch into ${binding.branch}` }] : []),
        ...(binding
          ? [{ id: 'review', section: 'save' as const, label: 'Open merge request…', hint: `${binding.provider === 'github' ? 'a pull request ' : ''}from ${binding.branch}` }]
          : []),
      ];
    },
    run,
  );

  // The History tab: the bound file's commits, one source per file and commit bound.
  let history: { key: string; source: HistoryGitSource } | undefined;
  const removeHistory = ui.setGitHistory((modelIri) => {
    const binding = bindings.get(modelIri);
    if (!binding) return undefined;
    const key = historyKey(binding);
    if (history?.key !== key) {
      history = {
        key,
        source: gitHistorySource(openContext, binding, {
          replace: (snapshot) => merging.support.replace(snapshot),
          clearConflicts: () => merging.support.clear(),
          room: () => app.collaborationRoom,
        }),
      };
    }
    return history.source;
  });

  if (options.open) await run('open', options.open);

  return {
    context,
    openContext,
    sync,
    stop() {
      stopped = true;
      sync?.stop();
      syncTab?.remove();
      syncPanel.removeEventListener('git-sync-action', onSyncAction);
      unsubscribe?.();
      eventBus.off('model-saved', onSaved);
      eventBus.off('collab-status', onEnvironment);
      eventBus.off('model-changed', onChange);
      document.removeEventListener('visibilitychange', onEnvironment);
      window.removeEventListener('online', onEnvironment);
      window.removeEventListener('offline', onEnvironment);
      window.removeEventListener('storage', onSettingsStorage);
      eventBus.off('model-loaded', onLoaded);
      removeMenu();
      removeSettings();
      removeHistory();
      merging.stop();
      tokens.clearSession();
    },
  };
}
