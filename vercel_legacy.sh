#!/bin/bash

# This script defines if vercel should deploy the commit,
# see https://vercel.com/support/articles/how-do-i-use-the-ignored-build-step-field-on-vercel
 
# Deployment rules are: (./configurator/frontend folder changed) AND (branch == beta or commit contains [vercel-preview] string)
cd configurator/frontend

git diff HEAD^ HEAD --quiet ./

if [[ $? == 0 ]]; then
    echo "❌ No changes in frontend, skipping deploy"
    exit 0
fi

if [[ "$VERCEL_GIT_COMMIT_REF" == "beta" ]]; then
    echo "✅ Branch is beta, deploying"
    exit 1
fi

if [[ $VERCEL_GIT_COMMIT_REF == *"newjitsu"* ]]; then
    echo "❌ Newjitsu branch, skipping deploy"
    exit 0
fi

if [[ $VERCEL_GIT_COMMIT_MESSAGE == *"[vercel-preview]"* ]]; then
    echo "✅ Commit message contains [vercel-preview] ($VERCEL_GIT_COMMIT_MESSAGE). Deploying"
    exit 1
fi

echo "❌ Branch is not beta or commit message does not contain [vercel-preview] string, skipping deploy"
exit 0
