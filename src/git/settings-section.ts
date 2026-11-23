/**
 * Git storage's section of *File › Settings…* (Req 18.15–18.16, Req 19.5–19.6):
 * the user's defaults for new saves, whether *Remember* starts ticked, the
 * tokens kept (to forget one), the host kinds learned (to forget them) — and,
 * shown but not offered for change, what the deployment sets: the hosts
 * allowed, a token policy of `never`.
 *
 * An empty field keeps no setting: the deployment's default, else la-gram's,
 * applies — the field's hint says which.
 */
import type { FormField, FormValues } from '../ui/dialogs.js';
import type { SettingsSection } from '../ui/mount-ui.js';
import type { GitConfig } from '../config.js';
import type { PersonalSettings } from '../settings.js';
import type { TokenStore } from './credentials.js';
import { branchProblem, gitDefaults, type PersonalGitSettings } from './git-save.js';
import { readLink, type HostKinds } from './host-kinds.js';
import { autoCommitKey, type AutoCommitStore } from './auto-commit-settings.js';
import type { GitBinding } from './bindings.js';

export interface GitSettingsDeps {
  config: GitConfig | undefined;
  personal: PersonalSettings;
  tokens: TokenStore;
  hostKinds: HostKinds;
  report(message: string): void;
  changed?(): void;
  autoCommits?: AutoCommitStore;
  target?(): { modelIri: string; binding: GitBinding } | undefined;
}

/** The kind's name, as people know it. */
const KIND = { github: 'GitHub', gitlab: 'GitLab' } as const;

export function gitSettingsSection(deps: GitSettingsDeps): SettingsSection {
  const { config, personal, tokens, hostKinds } = deps;
  const own = (): PersonalGitSettings => personal.get<PersonalGitSettings>('git');
  let targetKey: string | undefined;
  return {
    id: 'git',
    title: 'Git storage',
    detail: 'Defaults, remote checks, auto-commit for this destination and tokens. Empty: the default the hint names.',

    async fields(): Promise<FormField[]> {
      const mine = own();
      const fallback = gitDefaults(config); // the deployment's, else la-gram's
      const deployment = config?.defaults ?? {};
      const fields: FormField[] = [];
      if (config?.hosts) {
        fields.push({
          name: 'hosts',
          label: 'Git hosts allowed',
          value: config.hosts.map((h) => `${h.host} (${KIND[h.kind]})`).join(', ') || 'none',
          disabled: true,
          hint: 'Set by the deployment.',
        });
      }
      fields.push(
        {
          name: 'repository',
          label: 'Default repository',
          value: mine.repository ?? '',
          hint: deployment.repository ? `Empty: the deployment’s, ${deployment.repository} — or the last one used.` : 'Empty: the last one used.',
        },
        {
          name: 'branch',
          label: 'Default branch',
          value: mine.branch ?? '',
          hint: deployment.branch ? `Empty: the deployment’s, ${deployment.branch}.` : 'Empty: the repository’s default branch.',
        },
        {
          name: 'folder',
          label: 'Folder for new files',
          value: mine.folder ?? '',
          hint: `Empty: ${fallback.folder || 'the repository’s top'}${deployment.folder !== undefined ? ' (the deployment’s)' : ''}. A dot (.) for the repository’s top.`,
        },
        {
          name: 'message',
          label: 'Commit message',
          value: mine.message ?? '',
          hint: `Empty: ${fallback.message}. {action} is Add or Update; {model}, {path} and {branch} are filled in.`,
        },
        {
          name: 'branchPrefix',
          label: 'New branch names start with',
          value: mine.branchPrefix ?? '',
          hint: `Empty: ${fallback.branchPrefix}`,
        },
      );
      const target = deps.target?.();
      targetKey = target ? autoCommitKey(target.modelIri, target.binding) : undefined;
      const auto = deps.autoCommits?.get(targetKey ?? '');
      if (deps.autoCommits) fields.push(
        { name: 'autoCommitGroup', label: 'Auto-commit for this model and destination', type: 'group' },
        { name: 'autoCommitDestination', label: 'Destination', disabled: true,
          value: target ? `${target.modelIri} · ${target.binding.host} · ${target.binding.repository} · ${target.binding.branch} · ${target.binding.path}` : 'Open from Git or Save to Git first.' },
        { name: 'autoCommitMode', label: 'Auto-commit', type: 'select', value: auto?.mode ?? 'off', disabled: !target,
          options: [{ value: 'off', label: 'Off' }, { value: 'idle', label: 'After idle' }, { value: 'interval', label: 'At interval' }],
          hint: 'Explicitly enable for this model, repository, branch and file. Reconciles before saving with your token; conflicts pause it.' },
        { name: 'autoCommitIdle', label: 'Idle time', type: 'select', value: String(auto?.idleMinutes ?? 2), disabled: !target,
          options: [1, 2, 5, 10].map((n) => ({ value: String(n), label: `${n} ${n === 1 ? 'minute' : 'minutes'}` })) },
        { name: 'autoCommitInterval', label: 'Commit interval', type: 'select', value: String(auto?.intervalMinutes ?? 10), disabled: !target,
          options: [5, 10, 15, 30].map((n) => ({ value: String(n), label: `${n} minutes` })),
          hint: 'Only changed content is committed, while visible and online. Resume a paused auto-commit in the Git tab.' },
      );
      fields.push(
        { name: 'sync', label: 'Synchronization', type: 'group' },
        { name: 'checkIntervalMinutes', label: 'Check for remote changes', type: 'select',
          value: String(mine.checkIntervalMinutes ?? 0),
          options: [0, 1, 2, 5, 10].map((minutes) => ({ value: String(minutes), label: minutes ? `Every ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}` : 'Off' })),
          hint: 'For the open model while this app is visible and online. One tab checks each destination.' },
        { name: 'autoPull', label: 'Pull automatically when unchanged locally', type: 'checkbox', value: mine.autoPull === true,
          hint: 'Requires regular checks. Local changes are kept for manual Pull from Git. Nothing is committed.' },
      );
      if (config?.rememberTokens === 'never') {
        fields.push({
          name: 'remember',
          label: 'Remember tokens',
          value: 'Never: a token is kept for the session only',
          disabled: true,
          hint: 'Set by the deployment.',
        });
      } else if (tokens.rememberLabel) {
        fields.push({
          name: 'remember',
          label: 'Offer to remember a new token, ticked',
          type: 'checkbox',
          value: mine.rememberByDefault ?? tokens.rememberByDefault,
        });
      }
      for (const host of await tokens.hosts()) {
        fields.push({ name: `forget:${host}`, label: `Forget the token for ${host}`, type: 'checkbox', value: false });
      }
      const learned = hostKinds.list();
      if (learned.length > 0) {
        fields.push({
          name: 'forgetKinds',
          label: `Forget the host kinds learned: ${learned.map(([h, k]) => `${h} (${KIND[k]})`).join(', ')}`,
          type: 'checkbox',
          value: false,
        });
      }
      return fields;
    },

    validate(values: FormValues): string | null {
      const text = (name: string) => String(values[name] ?? '').trim();
      if (deps.autoCommits && targetKey) {
        if (!['off', 'idle', 'interval'].includes(text('autoCommitMode')) || ![1, 2, 5, 10].includes(Number(text('autoCommitIdle')))
          || ![5, 10, 15, 30].includes(Number(text('autoCommitInterval')))) return 'Choose a valid auto-commit mode and timing.';
        const target = deps.target?.();
        if (!target || autoCommitKey(target.modelIri, target.binding) !== targetKey) return 'The Git destination changed. Reopen Settings to configure it.';
      }
      if (![0, 1, 2, 5, 10].includes(Number(text('checkIntervalMinutes')))) return 'Choose Off, or a check every 1, 2, 5 or 10 minutes.';
      if (text('repository')) {
        try {
          readLink(text('repository'), undefined, config, hostKinds);
        } catch (err: unknown) {
          return err instanceof Error ? err.message : String(err);
        }
      }
      if (text('branch')) {
        const problem = branchProblem(text('branch'));
        if (problem) return problem;
      }
      const folder = text('folder');
      if (folder && folder !== '.' && (folder.startsWith('/') || folder.split('/').some((s) => s === '.' || s === '..'))) {
        return 'The folder is in the repository — models, or arch/models — not /models, nor with . or .. in it (a single . is the top).';
      }
      if (text('branchPrefix') && branchProblem(`${text('branchPrefix')}x`)) {
        return `New branch names cannot start with “${text('branchPrefix')}”.`;
      }
      return null;
    },

    async apply(values: FormValues): Promise<void> {
      const text = (name: string) => String(values[name] ?? '').trim();
      const target = deps.target?.();
      if (deps.autoCommits && targetKey && target && autoCommitKey(target.modelIri, target.binding) === targetKey) {
        const previous = deps.autoCommits.get(targetKey);
        const mode = text('autoCommitMode');
        deps.autoCommits.set(targetKey, { ...previous, mode: mode === 'idle' || mode === 'interval' ? mode : 'off',
          idleMinutes: Number(text('autoCommitIdle')), intervalMinutes: Number(text('autoCommitInterval')) });
        if (previous.mode === 'off' && mode !== 'off') deps.autoCommits.resume(targetKey);
      }
      const remember = typeof values['remember'] === 'boolean' ? values['remember'] : undefined;
      personal.set('git', {
        repository: text('repository'),
        branch: text('branch'),
        folder: text('folder').replace(/\/+$/, ''),
        message: text('message'),
        branchPrefix: text('branchPrefix'),
        rememberByDefault: remember,
        checkIntervalMinutes: Number(text('checkIntervalMinutes')) || undefined,
        autoPull: values['autoPull'] === true ? true : undefined,
      });
      if (remember !== undefined) tokens.rememberByDefault = remember;
      for (const [name, value] of Object.entries(values)) {
        if (name.startsWith('forget:') && value === true) {
          const host = name.slice('forget:'.length);
          await tokens.forget(host);
          deps.report(`The token for ${host} is forgotten.`);
        }
      }
      if (values['forgetKinds'] === true) hostKinds.clear();
      deps.changed?.();
    },
  };
}
