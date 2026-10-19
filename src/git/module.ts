/**
 * Git storage — la-gram's first switchable module (Req 18.1).
 *
 * Imported only when it is on (`src/modules.ts`), into a chunk of its own; a
 * build with `LA_GRAM_GIT=off` leaves the chunk out. Started, it adds its
 * entries to the File menu; stopped, it takes them away and forgets the
 * session's tokens.
 */
import type { App } from '../app.js';
import type { MountedUi } from '../ui/mount-ui.js';
import { isElectronEnvironment } from '../platform/platform-factory.js';
import { desktopBridge } from '../platform/desktop-bridge.js';
import { GitBindings } from './bindings.js';
import { DesktopTokenStore, WebTokenStore, type TokenStore } from './credentials.js';
import { setDesktop } from './errors.js';
import { saveToGit, type GitSaveContext } from './git-save.js';
import type { RepositoryLink } from './link.js';
import { GitHubProvider } from './providers/github.js';
import { GitLabProvider } from './providers/gitlab.js';
import type { GitHostProvider } from './providers/provider.js';

/** A provider for a repository. */
export function providerFor(link: RepositoryLink, token: string | undefined): GitHostProvider {
  return link.provider === 'github' ? new GitHubProvider(link, token) : new GitLabProvider(link, token);
}

/** The module, started. */
export interface GitStorage {
  /** Take the menu entries away and forget the session's tokens. */
  stop(): void;
  /** The Save flow's context (for tests and the console). */
  readonly context: GitSaveContext;
}

/** Start the module: its menu entries, its token store. */
export async function startGitStorage(app: App, ui: MountedUi): Promise<GitStorage> {
  const desktop = isElectronEnvironment();
  setDesktop(desktop);
  const bridge = desktopBridge();
  const tokens: TokenStore = (bridge && (await DesktopTokenStore.create(bridge))) || new WebTokenStore();
  const bindings = new GitBindings();
  const { eventBus } = app.components;

  const context: GitSaveContext = {
    modelIri: () => app.session.modelIri,
    modelLabel: () => app.session.modelLabel() || 'model',
    serialize: (format) => app.modelIO.serialize(app.session.modelIri, { format }),
    saved: (fileName) => eventBus.emit('model-saved', { fileName }),
    dialogs: ui.dialogs,
    report: (message, level) => ui.report(message, level),
    tokens,
    bindings,
    provider: providerFor,
  };

  const forgetToken = async (): Promise<void> => {
    const hosts = await tokens.hosts();
    if (hosts.length === 0) {
      ui.report('No Git token is kept.');
      return;
    }
    const host = await ui.dialogs.choose(
      'Forget a Git token',
      hosts.map((h) => ({ value: h, label: h })),
    );
    if (!host) return;
    await tokens.forget(host);
    ui.report(`The token for ${host} is forgotten.`);
  };

  const removeMenu = ui.addFileMenu(
    'git',
    () => {
      const modelIri = app.session.modelIri;
      const binding = modelIri ? bindings.get(modelIri) : undefined;
      return [
        binding
          ? { id: 'save', section: 'save' as const, label: 'Save to Git', hint: `${binding.repository} · ${binding.branch}` }
          : { id: 'save', section: 'save' as const, label: 'Save to Git…', hint: 'GitHub, GitLab' },
        ...(binding ? [{ id: 'save-as', section: 'save' as const, label: 'Save to Git as…', hint: 'another branch or file' }] : []),
        { id: 'forget-token', section: 'save' as const, label: 'Forget a Git token…' },
      ];
    },
    async (id) => {
      if (id === 'save') await saveToGit(context);
      else if (id === 'save-as') await saveToGit(context, true);
      else if (id === 'forget-token') await forgetToken();
    },
  );

  return {
    context,
    stop() {
      removeMenu();
      tokens.clearSession();
    },
  };
}
