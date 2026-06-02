#!/usr/bin/env sh
# Auto-format files staged for the current commit and re-stage them so
# the commit captures the formatted content. Invoked by both the husky
# pre-commit hook (.husky/pre-commit) and `pnpm format:staged`.
#
# Why not lint-staged? Adding it would mean another root devDependency
# for a workflow this script does in 10 lines of POSIX shell.

set -e

# --diff-filter=ACMR: Added / Copied / Modified / Renamed. Excludes
# Deleted, Unmerged, Type-changed, Unknown, Broken. The grep narrows to
# extensions prettier actually formats — without it, a pure-Go commit
# would pass an empty list to prettier and trip its "No parser and no
# file path given" error.
staged=$(git diff --cached --name-only --diff-filter=ACMR | \
  grep -E '\.(js|jsx|ts|tsx|mjs|cjs|json|md|mdx|yaml|yml|css|scss|less|html|vue|graphql|prisma)$' || true)

if [ -z "$staged" ]; then
  exit 0
fi

echo "$staged" | xargs prettier --ignore-unknown --write \
  --config ./.prettierrc.json --ignore-path ./.prettierignore

# Re-stage anything prettier rewrote. Files prettier left alone are a
# no-op for `git add`, so this is safe to run unconditionally.
echo "$staged" | xargs git add
