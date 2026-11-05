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
import type { MountedUi } from '../ui/mount-ui.js';
import { isElectronEnvironment } from '../platform/platform-factory.js';
import { desktopBridge } from '../platform/desktop-bridge.js';
import { GitBindings } from './bindings.js';
import { DesktopTokenStore, WebTokenStore, type TokenStore } from './credentials.js';
import { GitError, setDesktop } from './errors.js';
import type { GitConfig } from '../config.js';
import { saveToGit, type GitSaveContext } from './git-save.js';
import { updateFromBranch } from './git-merge.js';
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
  const personal = (): PersonalGitSettings => settings.get<PersonalGitSettings>('git');
  // The user's "Remember starts ticked", where tokens may be remembered at all.
  const mine = personal().rememberByDefault;
  if (mine !== undefined && tokens.rememberLabel) tokens.rememberByDefault = mine;
  const { eventBus } = app.components;

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
    merge: merging.support,
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
    gitSettingsSection({ config, personal: settings, tokens, hostKinds, report: (message) => ui.report(message) }),
  );

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
        ...(binding ? [{ id: 'update', section: 'save' as const, label: 'Update from main…', hint: `merge another branch into ${binding.branch}` }] : []),
        ...(binding
          ? [{ id: 'review', section: 'save' as const, label: 'Open merge request…', hint: `${binding.provider === 'github' ? 'a pull request ' : ''}from ${binding.branch}` }]
          : []),
      ];
    },
    async (id) => {
      if (id === 'open') await openFromGit(openContext);
      else if (id === 'save') await saveToGit(context);
      else if (id === 'save-as') await saveToGit(context, true);
      else if (id === 'update') await updateFromBranch(context);
      else if (id === 'review') await openMergeRequest(context);
    },
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

  if (options.open) await openFromGit(openContext, options.open);

  return {
    context,
    openContext,
    stop() {
      removeMenu();
      removeSettings();
      removeHistory();
      merging.stop();
      tokens.clearSession();
    },
  };
}
