#!/usr/bin/env bash
# Builds la-gram's and the kernel's histories as they go to GitHub, from the local checkouts, into a folder
# of their own. Pushes nothing, and changes neither checkout. README.md here, "The history", says why.
#
#   build-github-history.sh <new folder> [--allow-dirty]
#
#   la-gram   every commit, branch and tag; the branches merged into main left behind (their commits are
#             in main, the tags keep the releases)
#   kernel    la-gram's history of the kernel's files, up to the la-gram commit the kernel was copied from,
#             then the kernel's own commits on top, with the same files
#   both      one author, committer and tagger for every commit and tag (NAME <EMAIL> below); the
#             workspace's absolute path in files and messages written relative ("linked.archi/…")
#
# Then checks each result: the identities; no home folder and no other address in any commit, tag or file
# version; the same number of commits; branch tips with the same files, except where a path was rewritten.
# The commits the checkouts' files cite by hash are listed with their new hashes, to update after the move.
#
# Needs git-filter-repo on PATH (brew install git-filter-repo, or pip install git-filter-repo). Runs in
# macOS's bash 3.2.
# --allow-dirty: build from what is committed although a checkout has changes (a trial run).
# One-off: it reads la-gram's old history, so it has no use once the checkout follows GitHub.
set -euo pipefail

OUT="${1:?usage: build-github-history.sh <new folder> [--allow-dirty]}"
ALLOW_DIRTY="${2:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LA_GRAM="$(cd "$HERE/../../.." && pwd)"
KERNEL="$(cd "$LA_GRAM/../../platform/linked-archi-kernel" && pwd)"
WORKSPACE="$(cd "$LA_GRAM/../../.." && pwd)"

NAME="Kalin Maldzhanski"
EMAIL="k@apptik.io"

# The la-gram commit the kernel's first commit is grafted onto: of la-gram's commits, the one whose files
# differ least from the kernel's first commit, six minutes before it. The 22 files that differ are the 14
# tests left in la-gram (KD-4), the turtle-writer test adapted to the kernel, and the 7 files synced into
# the kernel again on 2026-11-23 (copy-manifest.json, "syncs"). Measured on 2026-11-25.
KERNEL_BASE=406a827
# The kernel's files in la-gram (the kernel kept their paths, KD-1): import-from-la-gram/README.md.
KERNEL_PATHS="src/rdf-engine/ src/metamodel-manager/ src/model-manager/
  src/import-export/model-io.ts src/import-export/__tests__/model-io.test.ts
  src/types/build-flags.d.ts src/storage-scope.ts src/__tests__/sync-assets.test.ts
  src/__tests__/fixtures/merge/ src/__tests__/fixtures/diff/
  scripts/sync-assets.mjs scripts/bench-model.mjs assets/ LICENSE"

die() { echo "error: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
lower() { tr '[:upper:]' '[:lower:]'; }

command -v git-filter-repo >/dev/null || die "git-filter-repo is not on PATH"
[ -e "$OUT" ] && die "$OUT exists: give a new folder"
for repo in "$LA_GRAM" "$KERNEL"; do
  if [ -n "$(git -C "$repo" status --porcelain)" ]; then
    [ "$ALLOW_DIRTY" = --allow-dirty ] || die "$repo has uncommitted changes: commit them first"
    echo "note: $repo has uncommitted changes, which the result does not have"
  fi
done
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

# Literal replacements, in order: the workspace first, so that its paths read "linked.archi/…".
printf 'literal:%s==>linked.archi\nliteral:%s==>~\n' "$WORKSPACE" "$HOME" > "$OUT/replace.txt"

# Only branches and tags travel: not the checkout's remote-tracking refs, stash or notes.
keep_heads_and_tags() {
  git for-each-ref --format='%(refname)' | { grep -Ev '^refs/(heads|tags)/' || true; } | while read -r ref; do
    git update-ref -d "$ref"
  done
}

# Every identity in the repository ("name|address"), commits and annotated tags.
identities() {
  { git log --all --format='%an|%ae%n%cn|%ce'
    git for-each-ref refs/tags --format='%(if)%(taggername)%(then)%(taggername)|%(taggeremail:trim)%(end)'
  } | { grep -v '^$' || true; } | sort -u
}

# A mailmap that gives every identity NAME <EMAIL>, after checking that each is this one person under
# another address or spelling: another contributor's commits must keep their author.
write_mailmap() {
  local file="$1" id name addr
  echo "$NAME <$EMAIL>" > "$file"
  identities > "$OUT/identities.tmp"
  while IFS= read -r id; do
    name="${id%%|*}"; addr="${id#*|}"
    [ "$(printf %s "$name" | lower)" = "$(printf %s "$NAME" | lower)" ] \
      || die "$(pwd): a commit or tag by someone else ($name): not rewriting it"
    [ "$addr" = "$EMAIL" ] || echo "$NAME <$EMAIL> <$addr>" >> "$file"
  done < "$OUT/identities.tmp"
  rm "$OUT/identities.tmp"
}

# Every object reachable from a branch or tag, as Git stores it: each file version, commit and tag.
all_objects() {
  git rev-list --all --objects | cut -d' ' -f1 | git cat-file --batch
}

# The checks every result must pass. $1: a file of the old addresses, one per line.
check_clean() {
  local old="$1" found
  [ "$(identities)" = "$NAME|$EMAIL" ] || die "$(pwd): identities left: $(identities | tr '\n' ' ')"
  found="$(all_objects | grep -a -c -F -e "$HOME" -e "$WORKSPACE" || true)"
  [ "$found" = 0 ] || die "$(pwd): $found lines still give the home folder"
  if [ -s "$old" ]; then
    found="$(all_objects | grep -a -c -F -f "$old" || true)"
    [ "$found" = 0 ] || die "$(pwd): $found lines still give an old address"
  fi
  echo "identities: $(identities)"
}

# A branch tip must hold the same files as before, except files the replacements changed.
# $1: the checkout, $2: the branch, $3: its old tip.
check_tip() {
  local repo="$1" branch="$2" old="$3" changed path list=""
  changed="$(diff <(git -C "$repo" ls-tree -r "$old") <(git ls-tree -r "refs/heads/$branch") \
    | awk -F'\t' '/^[<>] / { print $2 }' | sort -u || true)"
  for path in $changed; do
    git -C "$repo" show "$old:$path" | grep -qF -e "$HOME" -e "$WORKSPACE" \
      || die "$branch: $path changed, but held no home path"
    list="$list $path"
  done
  echo "$branch: same files${list:+, but paths written relative in:$list}"
}

# The commits a revision's files cite by a short hash, with their new hashes.
# $1: the checkout, $2: the revision, $3…: commit-map files ("old new") to look the hashes up in.
cited_hashes() {
  local repo="$1" rev="$2"; shift 2
  { git -C "$repo" grep -I -o -w -E '[0-9a-f]{7,12}' "$rev" -- . ':!package-lock.json' 2>/dev/null || true; } \
    | awk '
        FILENAME != "-" { if (length($1) == 40) for (n = 7; n <= 12; n++) map[substr($1, 1, n)] = substr($2, 1, n); next }
        { k = split($0, f, ":"); h = f[k]; if ((h in map) && map[h] != h) print f[2] ": " h " -> " map[h] }
      ' "$@" - | sort -u
}

step "la-gram"
git clone -q --mirror --no-local "$LA_GRAM" "$OUT/la-gram.git"
cd "$OUT/la-gram.git"
keep_heads_and_tags
for b in $(git for-each-ref refs/heads --merged main --format='%(refname:short)'); do
  [ "$b" = main ] || { git update-ref -d "refs/heads/$b"; echo "left behind, merged into main: $b"; }
done
git for-each-ref refs/heads --format='%(refname:short) %(objectname)' > "$OUT/la-gram.old-tips"
COMMITS_BEFORE="$(git rev-list --all --count)"
identities | cut -d'|' -f2 | { grep -vxF "$EMAIL" || true; } > "$OUT/old-addresses"
KERNEL_BASE_FULL="$(git rev-parse --verify "$KERNEL_BASE^{commit}")"
write_mailmap "$OUT/la-gram.mailmap"
git-filter-repo --force --quiet --replace-refs delete-no-add \
  --mailmap "$OUT/la-gram.mailmap" --replace-text "$OUT/replace.txt" --replace-message "$OUT/replace.txt"
cp filter-repo/commit-map "$OUT/la-gram.commit-map"
[ "$(git rev-list --all --count)" = "$COMMITS_BEFORE" ] \
  || die "la-gram: $COMMITS_BEFORE commits before, $(git rev-list --all --count) after"
echo "commits: $COMMITS_BEFORE; branches: $(cut -d' ' -f1 "$OUT/la-gram.old-tips" | tr '\n' ' ')tags: $(git tag | tr '\n' ' ')"
check_clean "$OUT/old-addresses"
while read -r b old; do check_tip "$LA_GRAM" "$b" "$old"; done < "$OUT/la-gram.old-tips"
NEW_BASE="$(awk -v o="$KERNEL_BASE_FULL" '$1 == o { print $2 }' "$OUT/la-gram.commit-map")"
[ -n "$NEW_BASE" ] || die "la-gram: $KERNEL_BASE is not in the result"

step "the kernel's files in la-gram, up to $KERNEL_BASE"
git clone -q --mirror --no-local "$OUT/la-gram.git" "$OUT/kernel-base.git"
cd "$OUT/kernel-base.git"
git for-each-ref --format='%(refname)' | while read -r ref; do git update-ref -d "$ref"; done
git update-ref refs/heads/base "$NEW_BASE"
set --; for p in $KERNEL_PATHS; do set -- "$@" --path "$p"; done
git-filter-repo --force --quiet --replace-refs delete-no-add "$@"
FILTERED="$(git rev-parse refs/heads/base)"
FILTERED_COUNT="$(git rev-list --count "$FILTERED")"
echo "commits: $FILTERED_COUNT"

step "kernel"
git clone -q --mirror --no-local "$KERNEL" "$OUT/kernel.git"
cd "$OUT/kernel.git"
keep_heads_and_tags
git for-each-ref refs/heads --format='%(refname:short) %(objectname)' > "$OUT/kernel.old-tips"
KCOMMITS_BEFORE="$(git rev-list --all --count)"
ROOTS="$(git rev-list --all --max-parents=0)"
[ "$(printf '%s\n' "$ROOTS" | wc -l | tr -d ' ')" = 1 ] || die "kernel: more than one first commit"
identities | cut -d'|' -f2 | { grep -vxF "$EMAIL" || true; } >> "$OUT/old-addresses"
sort -u -o "$OUT/old-addresses" "$OUT/old-addresses"
write_mailmap "$OUT/kernel.mailmap"
git fetch -q "$OUT/kernel-base.git" refs/heads/base:refs/heads/la-gram-history
git replace --graft "$ROOTS" "$FILTERED"
git update-ref -d refs/heads/la-gram-history
git-filter-repo --force --quiet --replace-refs delete-no-add \
  --mailmap "$OUT/kernel.mailmap" --replace-text "$OUT/replace.txt" --replace-message "$OUT/replace.txt"
cp filter-repo/commit-map "$OUT/kernel.commit-map"
[ -z "$(git for-each-ref refs/replace)" ] || die "kernel: the graft is still a replace ref"
[ "$(git rev-list --all --count)" = "$((KCOMMITS_BEFORE + FILTERED_COUNT))" ] \
  || die "kernel: expected $KCOMMITS_BEFORE + $FILTERED_COUNT commits, found $(git rev-list --all --count)"
echo "commits: $FILTERED_COUNT from la-gram + $KCOMMITS_BEFORE of the kernel's own"
check_clean "$OUT/old-addresses"
while read -r b old; do check_tip "$KERNEL" "$b" "$old"; done < "$OUT/kernel.old-tips"

step "hashes the files cite, old -> new"
{ while read -r b old; do
    cited_hashes "$LA_GRAM" "$old" "$OUT/la-gram.commit-map" | sed "s|^|la-gram $b: |"
  done < "$OUT/la-gram.old-tips"
  while read -r b old; do
    cited_hashes "$KERNEL" "$old" "$OUT/kernel.commit-map" "$OUT/la-gram.commit-map" | sed "s|^|kernel $b: |"
  done < "$OUT/kernel.old-tips"
} | tee "$OUT/cited-hashes.txt"

step "done: nothing pushed"
echo "Results: $OUT/la-gram.git and $OUT/kernel.git. Push each to its empty GitHub repository with its"
echo "branches and tags only (never --mirror), as README.md here says, \"Push\"."
