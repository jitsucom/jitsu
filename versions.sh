VERSION_FILE=$1

# Read version file
if [ ! -f "$VERSION_FILE" ]; then
  echo "Error: Version file $VERSION_FILE not found"
  exit 1
fi

BASE_VERSION=$(jq -r '.version' "$VERSION_FILE")
TAG_PREFIX=$(jq -r '.tag_prefix' "$VERSION_FILE")
STABLE_BRANCH=$(jq -r '.stable_branch' "$VERSION_FILE")
BETA_BRANCH=$(jq -r '.beta_branch' "$VERSION_FILE")

# Get current branch
CURRENT_BRANCH="${GITHUB_REF_NAME}"

# Determine channel: explicit override wins, otherwise derive from branch
if [ -n "${CHANNEL_OVERRIDE}" ]; then
  CHANNEL="${CHANNEL_OVERRIDE}"
elif [ "$CURRENT_BRANCH" = "$STABLE_BRANCH" ]; then
  CHANNEL="stable"
elif [ "$CURRENT_BRANCH" = "$BETA_BRANCH" ]; then
  CHANNEL="beta"
else
  CHANNEL="canary"
fi

PATCH="0"

PATTERN="^${TAG_PREFIX}${BASE_VERSION}[.]\d+$"
LATEST_STABLE_TAG=$(git tag -l | grep -E "$PATTERN" | sort -V | tail -n1)

echo "Latest tag: $LATEST_STABLE_TAG"

if [[ "$LATEST_STABLE_TAG" =~ ^${TAG_PREFIX}([0-9]+\.[0-9]+)\.?([0-9]*).*$ ]]; then
  if [ "${BASH_REMATCH[1]}" = "$BASE_VERSION" ]; then
    if [ -n "${BASH_REMATCH[2]}" ]; then
      PATCH="${BASH_REMATCH[2]}"
    fi
  else
    echo "Tag version ${BASH_REMATCH[1]} does not match base version $BASE_VERSION"
    PATCH="-1"
  fi
else
  PATCH="-1"
fi

PATCH=$((PATCH + 1))

echo "Current branch: $CURRENT_BRANCH"
echo "Base version: $BASE_VERSION"
echo "Next patch version: $PATCH"
echo "Tag prefix: $TAG_PREFIX"
echo "Channel: $CHANNEL"

if [ "$CHANNEL" = "stable" ]; then
    VERSION="${BASE_VERSION}.${PATCH}"
elif [ "$CHANNEL" = "beta" ]; then
    PATTERN="${TAG_PREFIX}${BASE_VERSION}.${PATCH}-beta.*"
    LATEST_TAG=$(git tag -l "$PATTERN" | sort -V | tail -n1)
    # Extract beta number and increment
    BETA_NUM=$(echo "$LATEST_TAG" | sed "s|${TAG_PREFIX}${BASE_VERSION}.${PATCH}-beta.||")
    if [ -z "$BETA_NUM" ]; then
      BETA_NUM=-1
    fi
    echo "Previous beta number: $BETA_NUM"
    NEW_BETA=$((BETA_NUM + 1))
    VERSION="${BASE_VERSION}.${PATCH}-beta.${NEW_BETA}"
else
  # Canary: BASE_VERSION-canary.DATE.SHORT_SHA
  SHORT_SHA=$(git rev-parse --short=7 HEAD)
  DATE=$(date +%Y%m%d)
  VERSION="${BASE_VERSION}.${PATCH}-canary.${DATE}.${SHORT_SHA}"
fi

TAG="${TAG_PREFIX}${VERSION}"

echo "Generated version: $VERSION"
echo "Generated tag: $TAG"

echo "version=${VERSION}" >> $GITHUB_OUTPUT
echo "tag=${TAG}" >> $GITHUB_OUTPUT
echo "channel=${CHANNEL}" >> $GITHUB_OUTPUT
