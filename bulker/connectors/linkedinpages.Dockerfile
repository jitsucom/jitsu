# jitsucom/source-linkedin-pages: Airbyte's source-linkedin-pages with an active LinkedIn API version (JITSU-248).
#
# airbyte/source-linkedin-pages 1.1.25 (24 May 2025, still the newest release) hardcodes
# `Linkedin-Version: "202503"` in all six streams. LinkedIn sunset that version on 16 Mar 2026 and
# started answering 426 NONEXISTENT_VERSION on 17 Oct 2026. This image changes only those header values.
#
# The base is pinned by digest (the multi-arch index) so the build is reproducible, and the build fails
# unless exactly 6 headers end up at the new version out of 6 in total, so a changed base cannot
# silently ship an unpatched manifest.
#
# This is a stopgap. When Airbyte publishes a release that fixes it, point services back at
# airbyte/source-linkedin-pages and retire this image.
FROM airbyte/source-linkedin-pages:1.1.25@sha256:7ed0c0bfb1530193f7817f4e8329b6b43defc9eac0cc102228391d7c4f7c24c6

ARG OLD_LINKEDIN_VERSION=202503
ARG LINKEDIN_VERSION=202610
ARG MANIFEST=/airbyte/integration_code/source_declarative_manifest/manifest.yaml

USER root
RUN set -eu; \
    case "${LINKEDIN_VERSION}" in 20[0-9][0-9]0[1-9]|20[0-9][0-9]1[0-2]) ;; *) echo "LINKEDIN_VERSION must be YYYYMM, got '${LINKEDIN_VERSION}'" >&2; exit 1;; esac; \
    sed -i "s/Linkedin-Version: \"${OLD_LINKEDIN_VERSION}\"/Linkedin-Version: \"${LINKEDIN_VERSION}\"/" "${MANIFEST}"; \
    new="$(grep -c "Linkedin-Version: \"${LINKEDIN_VERSION}\"" "${MANIFEST}" || true)"; \
    total="$(grep -c -i 'linkedin-version' "${MANIFEST}" || true)"; \
    if [ "${new}" != "6" ] || [ "${total}" != "6" ]; then \
      echo "expected 6 headers set to ${LINKEDIN_VERSION} out of 6, got ${new} out of ${total}" >&2; exit 1; \
    fi
USER airbyte

LABEL io.jitsu.base-image="airbyte/source-linkedin-pages:1.1.25" \
      io.jitsu.linkedin-api-version="${LINKEDIN_VERSION}"
