#!/bin/bash

# This script defines if vercel should deploy the commit,
# see https://vercel.com/support/articles/how-do-i-use-the-ignored-build-step-field-on-vercel


echo "❌ $VERCEL_GIT_COMMIT_REF branch doesn't contain jitsu legacy code, skipping deploy."
exit 0