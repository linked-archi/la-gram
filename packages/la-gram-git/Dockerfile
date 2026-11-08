# la-gram-git's container image: the npm package, installed globally, with Git.
#
# Built by la-gram's release pipeline (.gitlab-ci.yml) from the package `npm pack`
# made, so the image holds exactly what npm publishes. By hand, from la-gram's folder:
#
#   npm run build:cli && (cd packages/la-gram-git && npm pack)
#   docker build --tag la-gram-git packages/la-gram-git
#
# No ENTRYPOINT: a CI job runs its script in the image's shell, which an entrypoint
# would replace. Run the tool by name: `docker run … la-gram-git check`.
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}

ARG VERSION=0.0.0
LABEL org.opencontainers.image.title="la-gram-git" \
      org.opencontainers.image.description="la-gram's architecture models in Git: checked, rewritten as la-gram writes them, compared and merged by element" \
      org.opencontainers.image.source="https://gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram" \
      org.opencontainers.image.documentation="https://gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram/-/tree/main/packages/la-gram-git" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}"

# git: check --base, diff, merge and init call it. ca-certificates: diff --comment
# calls the host's API over HTTPS.
#
# safe.directory: a repository mounted into the container belongs to the host's
# user, not the container's, and Git refuses to read a repository someone else
# owns. This image runs nothing but la-gram-git, so it trusts the one it is given.
RUN apt-get update \
 && apt-get install --yes --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*'

COPY linked-archi-la-gram-git-*.tgz /tmp/
RUN npm install --global --no-audit --no-fund /tmp/linked-archi-la-gram-git-*.tgz \
 && rm /tmp/linked-archi-la-gram-git-*.tgz \
 && npm cache clean --force

WORKDIR /repo
CMD ["la-gram-git", "--help"]
