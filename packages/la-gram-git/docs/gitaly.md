# la-gram's merge driver on Gitaly

For administrators of a **self-managed GitLab** instance.

When GitLab merges a merge request, its Git servers (Gitaly) merge the branches with Git, which merges a
model file as text. Two changes to different elements of one model file can then conflict, as text, even
though they never touched the same thing. With la-gram-git set up as a custom merge driver on Gitaly, Git
merges model files by element instead, with la-gram's own merge, and such a merge request merges.

This is optional. la-gram merges by element when it saves to Git, and `la-gram-git check` in CI catches a
broken model on any host. GitLab supports custom merge drivers on self-managed instances only — not on
gitlab.com or GitLab Dedicated — as described in GitLab's documentation on
[Git attributes](https://docs.gitlab.com/user/project/repository/files/git_attributes/), under
*Custom merge drivers*.

Git runs a merge driver only for a file that both sides changed. GitLab's documentation puts it this way:
the driver runs only for a "non-trivial merge conflict".

## 1. Install la-gram-git on every Gitaly node

Each Gitaly node needs Node.js 20 or later, and the same version of la-gram-git:

```sh
sudo npm install --global @linked-archi/la-gram-git@0.1.0
```

npm fetches the package and its three dependencies (`n3`, `oxigraph`, `rdf-validate-shacl`) from the
registry, or from your mirror of it. Pin the version, and install the same one on every node.

Gitaly starts Git with an environment of its own, whose `PATH` need not include Node.js. So the driver is
given by absolute paths: Node.js's, and the tool's script.

```sh
command -v node                       # e.g. /usr/bin/node
echo "$(npm root --global)/@linked-archi/la-gram-git/dist/la-gram-git.js"
                                      # e.g. /usr/lib/node_modules/@linked-archi/la-gram-git/dist/la-gram-git.js
```

Check that the user Gitaly runs as (`git` on a Linux package installation) can run it:

```sh
sudo -u git /usr/bin/node /usr/lib/node_modules/@linked-archi/la-gram-git/dist/la-gram-git.js --version
```

## 2. Define the driver in Gitaly's Git configuration

The driver's name must be `la-gram-git`: the name `la-gram-git init merge-driver` writes into
`.gitattributes`. In the examples, replace the two paths with yours.

**Linux package** — in `/etc/gitlab/gitlab.rb`, then `sudo gitlab-ctl reconfigure`:

```ruby
gitaly['configuration'] = {
  # ...
  git: {
    # ...
    config: [
      # ...
      { key: "merge.la-gram-git.name", value: "la-gram models, merged by element" },
      { key: "merge.la-gram-git.driver", value: "/usr/bin/node /usr/lib/node_modules/@linked-archi/la-gram-git/dist/la-gram-git.js merge %O %A %B %P" },
    ],
  },
}
```

**Self-compiled** — in `gitaly.toml`, then restart Gitaly:

```toml
[[git.config]]
key = "merge.la-gram-git.name"
value = "la-gram models, merged by element"

[[git.config]]
key = "merge.la-gram-git.driver"
value = "/usr/bin/node /usr/lib/node_modules/@linked-archi/la-gram-git/dist/la-gram-git.js merge %O %A %B %P"
```

**Helm chart** — GitLab's documentation gives the same keys under `gitlab.gitaly.git.config` in the chart's
values. The chart's Gitaly image has no Node.js, though: the driver needs a Gitaly image you build with
Node.js and la-gram-git added. Gitaly nodes that run outside the cluster are set up as for the Linux
package.

With Gitaly Cluster, configure every Gitaly node.

## 3. Route each repository's model files to it

In each repository whose models should merge by element, the `.gitattributes` file in the repository's
root sends the model files to the driver:

```gitattributes
# Model files merged by element (la-gram-git)
*.ttl merge=la-gram-git
*.trig merge=la-gram-git
*.jsonld merge=la-gram-git
*.nq merge=la-gram-git
*.nt merge=la-gram-git
*.rdf merge=la-gram-git
```

`la-gram-git init merge-driver`, run in a clone, writes these lines, and defines the driver for that clone
as well. Commit the file to the default branch, so that both sides of every merge request have it.

Routing by extension sends other RDF files there too, such as ontologies and shapes. The driver merges a
file that is not a la-gram model as Git merges text, so those merge as they did before.

## 4. Try it

In a test project:

1. Commit a model file, made in la-gram or written as la-gram writes it (`la-gram-git fix`), and the
   `.gitattributes` above.
2. On each of two branches, add a different element whose IRI sorts after every other in the file — say
   `…/zz-one` on one branch and `…/zz-two` on the other — and run `la-gram-git fix` on the file. la-gram
   writes subjects in the order of their IRIs, so both additions land at the end of the file, where as
   text they conflict.
3. Open a merge request for one branch, and merge it. Then open one for the other. Without the driver,
   GitLab reports a merge conflict; with it, the request merges, and the file holds both elements, as
   la-gram writes it.

If the second request still conflicts, the driver did not run. Check the paths with `sudo -u git …` as in
step 1, check that the configuration reached Gitaly, and look in Gitaly's log.

## When the changes meet

Where both sides changed the same thing, the driver exits 1 and GitLab reports a merge conflict. Examples
are one element's name changed both ways, or an element one side deleted and the other changed.

Resolve it as without the driver: in la-gram, with *Update from main*, which shows both sides of each
conflict; or in a clone, with `git merge` and the driver set up there. The driver never writes
`<<<<<<<` markers into a model file, so GitLab's own conflict editor has nothing to show for one.

## Cost, safety, upgrades

- **Cost.** Each merged model file starts Node.js and la-gram's engine on the Gitaly node: about a second
  for a small model, more for a large one. Git runs the driver whenever it merges such a file on the
  server.
- **What it does.** It runs as Gitaly's user, on the content of the repositories. It reads the three
  versions Git hands it, writes the merged file Git asks for, reads the metamodels bundled with it, and
  makes no network request.
- **Upgrades.** Install the new version on every node. The paths stay the same, so the configuration does
  not change.
- **Removing it.** Take the two entries out of Gitaly's configuration and reconfigure. A file that
  `.gitattributes` still routes to `la-gram-git` then merges as text: Git falls back to its own merge for a
  driver it does not know.
