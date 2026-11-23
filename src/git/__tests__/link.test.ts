/**
 * Repository links as people paste them (Req 18.2), and a bound file's, as Model settings shows it (Req 18.30).
 */
import { describe, it, expect } from 'vitest';
import { fileLink, parseRepositoryLink, repositoryLinkProblem } from '../link.js';

describe('GitHub links', () => {
  it('a repository, with or without .git', () => {
    for (const text of ['https://github.com/acme/arch', 'https://github.com/acme/arch.git', 'https://github.com/acme/arch/']) {
      const link = parseRepositoryLink(text);
      expect(link).toMatchObject({
        host: 'github.com',
        provider: 'github',
        providerKnown: true,
        apiBase: 'https://api.github.com',
        repository: 'acme/arch',
        webUrl: 'https://github.com/acme/arch',
      });
      expect(link.branch).toBeUndefined();
      expect(link.path).toBeUndefined();
    }
  });

  it('a branch, and a file on a branch', () => {
    expect(parseRepositoryLink('https://github.com/acme/arch/tree/dev')).toMatchObject({ branch: 'dev' });
    expect(parseRepositoryLink('https://github.com/acme/arch/blob/main/models/shop%20floor.ttl')).toMatchObject({
      repository: 'acme/arch',
      branch: 'main',
      path: 'models/shop floor.ttl',
    });
  });

  it('a page of the repository that names no branch', () => {
    const link = parseRepositoryLink('https://github.com/acme/arch/pulls');
    expect(link.repository).toBe('acme/arch');
    expect(link.branch).toBeUndefined();
  });

  it('the SSH address, read as the HTTPS one', () => {
    expect(parseRepositoryLink('git@github.com:acme/arch.git')).toMatchObject({ host: 'github.com', repository: 'acme/arch' });
  });

  it('GitHub Enterprise Server: the API under /api/v3', () => {
    const link = parseRepositoryLink('https://github.acme.example/platform/arch');
    expect(link).toMatchObject({ provider: 'github', providerKnown: false, apiBase: 'https://github.acme.example/api/v3' });
  });
});

describe('GitLab links', () => {
  it('a project in subgroups', () => {
    expect(parseRepositoryLink('https://gitlab.com/acme/platform/arch.git')).toMatchObject({
      host: 'gitlab.com',
      provider: 'gitlab',
      apiBase: 'https://gitlab.com/api/v4',
      repository: 'acme/platform/arch',
      webUrl: 'https://gitlab.com/acme/platform/arch',
    });
  });

  it('a file on a branch, after the /-/', () => {
    expect(parseRepositoryLink('https://gitlab.com/acme/platform/arch/-/blob/dev/models/shop.trig')).toMatchObject({
      repository: 'acme/platform/arch',
      branch: 'dev',
      path: 'models/shop.trig',
    });
  });

  it('a self-managed host, its port kept; the /-/ says GitLab', () => {
    expect(parseRepositoryLink('https://git.example.org:8443/acme/arch/-/tree/main')).toMatchObject({
      host: 'git.example.org:8443',
      provider: 'gitlab',
      providerKnown: true,
      apiBase: 'https://git.example.org:8443/api/v4',
      branch: 'main',
    });
  });

  it('an unknown host is GitLab unless the user says GitHub', () => {
    expect(parseRepositoryLink('https://code.example.org/acme/arch')).toMatchObject({ provider: 'gitlab', providerKnown: false });
    expect(parseRepositoryLink('https://code.example.org/acme/arch', 'github')).toMatchObject({
      provider: 'github',
      providerKnown: true,
      apiBase: 'https://code.example.org/api/v3',
    });
  });

  it('ssh:// addresses', () => {
    expect(parseRepositoryLink('ssh://git@gitlab.example.org/acme/arch.git')).toMatchObject({
      host: 'gitlab.example.org',
      repository: 'acme/arch',
    });
  });
});

describe('a file’s link, as Model settings shows it (Req 18.30)', () => {
  it('the host’s page for the file on its branch, read back as the same file', () => {
    const cases = [
      ['https://github.com/acme/arch', 'main', 'models/shop floor.ttl', 'https://github.com/acme/arch/blob/main/models/shop%20floor.ttl'],
      ['https://gitlab.com/acme/ea/arch', 'model-update', 'models/a.trig', 'https://gitlab.com/acme/ea/arch/-/blob/model-update/models/a.trig'],
      ['https://git.acme.internal:8443/ea/arch', 'main', 'a.ttl', 'https://git.acme.internal:8443/ea/arch/-/blob/main/a.ttl'],
    ] as const;
    for (const [repository, branch, path, expected] of cases) {
      const link = parseRepositoryLink(repository);
      expect(fileLink(link, branch, path)).toBe(expected);
      expect(parseRepositoryLink(expected)).toMatchObject({ host: link.host, provider: link.provider, repository: link.repository, branch, path });
    }
  });
});

describe('what is refused, and why', () => {
  it('a token in the address', () => {
    expect(repositoryLinkProblem('https://oauth2:abc123@gitlab.com/acme/arch')).toMatch(/token is given separately/);
  });

  it('plain http, but for this machine', () => {
    expect(repositoryLinkProblem('http://github.com/acme/arch')).toMatch(/https/);
    expect(repositoryLinkProblem('http://localhost:8929/acme/arch')).toBeNull();
  });

  it('too little to name a repository, or not an address', () => {
    expect(repositoryLinkProblem('https://github.com/acme')).toMatch(/owner and a repository/);
    expect(repositoryLinkProblem('https://gitlab.com/acme')).toMatch(/group and a project/);
    expect(repositoryLinkProblem('acme/arch')).toMatch(/not an address/);
    expect(repositoryLinkProblem('')).toMatch(/Give the repository/);
  });
});
