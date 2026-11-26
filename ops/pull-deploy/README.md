# Pull deploy: app.linked.archi installs la-gram from GitHub

The server fetches la-gram's web app from the GitHub Releases that `.github/workflows/la-gram.yml`
publishes, and puts it in place itself. No CI job connects to the server, and no key to it is stored
anywhere: it replaces the SSH deploy of la-gram's former GitLab pipeline (`web-deploy`, `alpha-deploy` and
their `DEPLOY_SSH_KEY`), which left the repository with the move to GitHub.
Why, and what is still to do: [`.agents/tasks/pull-deploy/`](../../.agents/tasks/pull-deploy/README.md).

| File | Installed as |
|---|---|
| `la-gram-pull` | `/usr/local/bin/la-gram-pull`, mode 755 |
| `la-gram-pull@.service` | `/etc/systemd/system/la-gram-pull@.service` |
| `la-gram-pull@.timer` | `/etc/systemd/system/la-gram-pull@.timer` |
| `la-gram-pull.conf.example` | `/etc/la-gram-pull.conf`, root:la-gram-pull, mode 640 |
| this file | `/usr/local/share/doc/la-gram-pull/README.md` (the unit's documentation) |

## What it does

Every five minutes, for each channel, `la-gram-pull@production.timer` and `la-gram-pull@alpha.timer` run
`la-gram-pull production` and `la-gram-pull alpha`:

| | production | alpha |
|---|---|---|
| Takes | the newest release `la-gram-v<x.y.z>`: never a draft, a pre-release (`-rc.1`) or la-gram-git's | the pre-release `la-gram-alpha`, which each push to main makes again while `package.json` says a pre-release |
| Build record must name | `refs/tags/la-gram-v<x.y.z>` | `refs/heads/main` |
| Serves it as | `/la-gram/` → `releases/<version>/`, with the desktop apps in `downloads/` | `/la-gram-alpha/` → `alpha/<version>-<commit>/` |
| Its version's page | in `versions/`, and in the release served: `/la-gram/v<version>/` | the same: `/la-gram/v0.3.0-alpha/`, in the release served |

Before anything is served, each file it downloads must:

1. have the SHA-256 that the release's `SHA256SUMS.txt` gives;
2. have a build record that `gh attestation verify` accepts: signed for `.github/workflows/la-gram.yml` in
   `REPO`, on a GitHub-hosted runner, from the ref above. A file someone uploads by hand, or builds in
   another workflow, on another branch or in a fork, has none, and is refused.

The web app must also unpack to a folder with `index.html`, `docs/index.html` and its version's page, with no
path outside the folder and no link.

Then it points the link at the new folder in one rename, and fetches `SITE/<link>/index.html`. If that
is not the new `index.html`, it points the link back and removes the folder. A build it refuses or rolls
back is **held**: not fetched again until a newer one is published, or `--force`. Each check that finds
nothing new is an answer of 304 from GitHub, which costs nothing of its limit of 60 questions an hour.

Two runs never overlap (a lock in `/var/lib/la-gram-pull/`): the alpha writes its version's page into the
release served.

## Install

On the server, as root. The script needs `bash` 4.4 or later, `curl`, `jq`, `tar`, GNU `coreutils` and
`flock` (util-linux), and the GitHub CLI, `gh`, 2.70 or later (`gh attestation verify --help` lists
`--source-ref` and `--deny-self-hosted-runners`).

```bash
# The user it runs as: no shell, no home, no sudo.
useradd --system --user-group --no-create-home --shell /usr/sbin/nologin la-gram-pull
install -d -o la-gram-pull -g la-gram-pull -m 750 /var/lib/la-gram-pull

# The files.
install -m 755 la-gram-pull /usr/local/bin/la-gram-pull
install -m 644 la-gram-pull@.service la-gram-pull@.timer /etc/systemd/system/
install -o root -g la-gram-pull -m 640 la-gram-pull.conf.example /etc/la-gram-pull.conf
install -D -m 644 README.md /usr/local/share/doc/la-gram-pull/README.md
systemctl daemon-reload

# The web root, its user's: it makes folders and links there. nginx reads it as anyone may (755/644).
chown -R la-gram-pull:la-gram-pull /var/www/linked-archi-app
```

Read `/etc/la-gram-pull.conf`. The defaults fit app.linked.archi; `REPO` must be the repository the
releases are in. **nginx's configuration does not change**: it serves `la-gram/` and `la-gram-alpha/`
as before, following the links (`disable_symlinks` is off unless the site turns it on).

## Try it, changing nothing served

After the first `la-gram-v` release on GitHub, and the first push to main since:

```bash
sudo -u la-gram-pull la-gram-pull production --dry-run
sudo -u la-gram-pull la-gram-pull alpha --dry-run
ls /var/lib/la-gram-pull/staging/production/*/ /var/lib/la-gram-pull/staging/production/*/downloads/
```

A dry run downloads, checks and unpacks into `/var/lib/la-gram-pull/staging/` only. If `gh` asks to log
in, set `GH_TOKEN` in the configuration (it says which token). If a check fails, it says which file and why.

To see a refusal: copy a release file, change a byte, and verify it as the script does. It must fail:

```bash
gh attestation verify ./la-gram-web-0.2.0.tar.gz --repo linked-archi/la-gram \
  --signer-workflow linked-archi/la-gram/.github/workflows/la-gram.yml \
  --source-ref refs/tags/la-gram-v0.2.0 --deny-self-hosted-runners
```

## Switch over

`la-gram/` and `la-gram-alpha/` are folders the SSH deploy fills. `adopt` makes each the first release
of its channel, moved and linked in two renames. It also copies the version pages from `la-gram/` into
`versions/`:

```bash
sudo -u la-gram-pull la-gram-pull adopt
ls -l /var/www/linked-archi-app        # la-gram -> releases/adopted-…, la-gram-alpha -> alpha/adopted-…
curl -sI https://app.linked.archi/la-gram/ | head -n 1   # HTTP/2 200

systemctl enable --now la-gram-pull@production.timer la-gram-pull@alpha.timer
systemctl start la-gram-pull@production.service           # at once, rather than in five minutes
journalctl -u 'la-gram-pull@*' -n 50
```

From now on, nothing writes into these folders but `la-gram-pull`: the SSH deploy's jobs left the
repository with `.gitlab-ci.yml`, and its key left GitLab before the switch-over.

Then try both channels:

1. A **pre-release**, `la-gram-v<next>-rc.1`: its Release is published, and `la-gram-pull production`
   says *nothing new* or *… is served already*. The pre-release is never installed.
2. A **release**: within five minutes `/la-gram/` is the new version, *About la-gram* says so, and
   *Download the desktop app…* downloads its apps.
3. A **merge to main**: within five minutes `/la-gram-alpha/` is the new alpha, and
   `/la-gram/v<version>-alpha/` names its commit.
4. A **rollback**, `sudo -u la-gram-pull la-gram-pull rollback production`, then
   `la-gram-pull production --force` to install the release again.

## Roll back

```bash
sudo -u la-gram-pull la-gram-pull rollback production   # or alpha
```

The link points at the folder served before, and the build rolled back from is held, so the next check
does not install it again. A newer release ends the hold, as does `la-gram-pull production --force`.
`KEEP_RELEASES` (2) is how many folders there are to go back to. A release's folder has its desktop apps:
about 0.7 GB each.

## When it fails

Each run's lines are in the journal: `journalctl -u la-gram-pull@production`. A run that fails leaves
what is served as it was. To hear of it, give the service an `OnFailure=` unit that mails or posts:

```ini
# /etc/systemd/system/la-gram-pull@.service.d/notify.conf
[Unit]
OnFailure=notify-failure@%n.service
```

| It says | Means |
|---|---|
| `its build record does not say … built it from …` | the file was not built by the workflow from that ref: published by hand, from another branch, or changed since. Held: the next check will not fetch it again |
| `GitHub answered 403` | GitHub's hourly limit, or a token it refuses: set or renew `GH_TOKEN` |
| `… does not answer its index.html; … is served again` | nginx does not serve the new folder: `disable_symlinks`, a cache in front, or the server cannot reach its own address (set `CHECK_RESOLVE`) |
| `… is a folder, not a link: run la-gram-pull adopt once` | `adopt` has not run on this server yet: see *Switch over* |
| `alpha: la-gram-alpha is not published (now)` | between the deletion of the last alpha and the publication of the next, on a push to main. Not a failure |

## Once it works: the SSH deploy away

1. In GitLab, *Settings › CI/CD › Variables*: delete what is left, `DEPLOY_HOST`, `DEPLOY_USER` and
   `LA_GRAM_DEPLOY_PATH`, in both environments (`DEPLOY_SSH_KEY` went before the switch-over).
2. On the server: the key's line out of the deploy user's `~/.ssh/authorized_keys`. Remove the user too,
   unless meta.linked.archi's deploy still uses it.
3. `rm -rf /var/www/linked-archi-app/releases/adopted-*` and `alpha/adopted-*`, once a release and an
   alpha have replaced them.
