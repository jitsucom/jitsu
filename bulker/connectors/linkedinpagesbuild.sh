#!/usr/bin/env bash
# Builds and pushes jitsucom/source-linkedin-pages (see linkedinpages.Dockerfile, JITSU-248).
# Needs `docker login` as a user with push rights to the jitsucom Docker Hub org.
#
# The tag has to match ^[0-9.]+$ for the console's version list to show it as a release
# (webapps/console/pages/api/sources/versions.ts), so it is <airbyte version>.<our revision>.
set -euo pipefail
cd "$(dirname "$0")"

VERSION="1.1.25.1"

if [ "${1:-}" != "--yes" ]; then
  read -r -p "Push jitsucom/source-linkedin-pages:${VERSION} and :latest to Docker Hub? [y/N] " answer
  [ "${answer}" = "y" ] || { echo "aborted"; exit 1; }
fi

# the image needs no build context, so use an empty one
docker buildx build --platform linux/amd64,linux/arm64 -f linkedinpages.Dockerfile \
  -t jitsucom/source-linkedin-pages:latest -t "jitsucom/source-linkedin-pages:${VERSION}" --push "$(mktemp -d)"
