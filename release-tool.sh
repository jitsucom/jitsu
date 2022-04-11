#!/usr/bin/env bash


# Highlights args with color
# Only red is supported so far
#
function chalk() {
  local color=$1; shift
  local color_code=0
  if [[ $color == "red" ]]; then
    color_code=1
  elif [[ $color == "green" ]]; then
    color_code=2
  fi

  echo -e "$(tput setaf $color_code)$*$(tput sgr0)"
}

function fail() {
  local error="$*" || 'Unknown error'
  echo "$(chalk red "${error}")" ; exit 1
}

function build_server() {
  echo "Building Server lib JS locally.."
  rm -rf server/build && rm -rf javascript-sdk/* && \
  cd javascript-sdk && curl $(npm v @jitsu/sdk-js@latest dist.tarball) | tar -xz && mv package/dist/web/* . && rm -r package && \
  cd ../server && make js_release && cd ../ || fail 'Server build failed'
}

function build_configurator() {
  echo "Building Configurator UI locally.."
  rm -f configurator/backend/build/dist/configurator && rm -rf configurator/frontend/main/build && \
  cd configurator/frontend/ && yarn clean && yarn install --prefer-offline && CI=false ANALYTICS_KEYS='{"eventnative": "js.gpon6lmpwquappfl07tuq.ka5sxhsm08cmblny72tevi"}' yarn build && \
  cd ../../ || fail 'Configurator build failed'
}

function release_server() {
  docker login -u="$JITSU_DOCKER_LOGIN" -p="$JITSU_DOCKER_PASSWORD" || fail "Docker jitsu ($JITSU_DOCKER_LOGIN) login failed"

  if [[ $1 =~ $SEMVER_EXPRESSION ]]; then
    echo "**** Server amd64/arm64 release [$1] ****"
    docker buildx build --platform linux/amd64,linux/arm64 --push -t jitsucom/server:"$1" -t jitsucom/server:latest -f server-release.Dockerfile --build-arg dhid=jitsucom . || fail 'Server dockerx build semver failed'

    docker login -u="$KSENSE_DOCKER_LOGIN" -p="$KSENSE_DOCKER_PASSWORD" || fail  "Docker ksense login failed"
    docker buildx build --platform linux/amd64 --push -t ksense/eventnative:"$1" -t ksense/eventnative:latest -f server-release.Dockerfile --build-arg dhid=ksense . || fail 'ksense/eventnative dockerx build semver failed'
  else
    if [[ "$1" == "beta" ]]; then
      echo "**** Server $2 release [$1] ****"
      docker buildx build --platform $2 --push -t jitsucom/server:"$1" -f server-release.Dockerfile --build-arg dhid=jitsucom  . || fail  'Server dockerx build failed'
    else
      echo "**** Server $2 release [$1] ****"
      docker buildx build --platform $2 --push -t jitsucom/server:"$1" -f server-release.Dockerfile --build-arg dhid=jitsucom  . || fail  'Server dockerx build failed'
    fi
  fi
}

function release_configurator() {
  docker login -u="$JITSU_DOCKER_LOGIN" -p="$JITSU_DOCKER_PASSWORD" || fail 'Docker jitsu login failed'

  if [[ $1 =~ $SEMVER_EXPRESSION ]]; then
     echo "**** Configurator amd64/arm64 release [$1] ****"
    docker buildx build --platform linux/amd64,linux/arm64 --push -t jitsucom/configurator:"$1" -t jitsucom/configurator:latest --build-arg dhid=jitsucom -f configurator-release.Dockerfile . || fail  'Configurator dockerx build semver failed'
  else
    if [[ "$1" == "beta" ]]; then
      echo "**** Configurator $2 release [$1] ****"
      docker buildx build --platform $2 --push -t jitsucom/configurator:"$1" --build-arg dhid=jitsucom -f configurator-release.Dockerfile . || fail  'Configurator dockerx build failed'
    else
      echo "**** Configurator $2 release [$1] ****"
      docker buildx build --platform $2 --push -t jitsucom/configurator:"$1" --build-arg dhid=jitsucom -f configurator-release.Dockerfile . || fail  'Configurator dockerx build failed'
    fi
  fi
}

function release_jitsu() {
  echo "**** Jitsu release [$1] ****"
  docker login -u="$JITSU_DOCKER_LOGIN" -p="$JITSU_DOCKER_PASSWORD" || fail 'Docker jitsu login failed'

  cd docker && \
  docker pull jitsucom/configurator:"$1" && \
  docker pull jitsucom/configurator:latest && \
  docker pull jitsucom/server:"$1" && \
  docker pull jitsucom/server:latest || fail 'Jitsu docker pull failed'

  if [[ $1 =~ $SEMVER_EXPRESSION ]]; then
    docker buildx build --platform linux/amd64,linux/arm64 --push -t jitsucom/jitsu:"$1" -t jitsucom/jitsu:latest --build-arg dhid=jitsu --build-arg SRC_VERSION=latest . || { echo 'Jitsu dockerx build semver failed' ; exit 1; }
  else
    if [[ "$1" == "beta" ]]; then
      docker buildx build --platform $2 --push -t jitsucom/jitsu:"$1" --build-arg dhid=jitsu --build-arg SRC_VERSION="$1" . || { echo 'Jitsu dockerx build failed' ; exit 1; }
    else
      docker buildx build --platform $2 --push -t jitsucom/jitsu:"$1" --build-arg dhid=jitsu --build-arg SRC_VERSION="$1" . || { echo 'Jitsu dockerx build failed' ; exit 1; }
    fi
  fi

  cd ../
}


SEMVER_EXPRESSION='^([0-9]+\.){0,2}(\*|[0-9]+)$'
echo "Release tool running..."
CURRENT_BRANCH=$(git branch --show-current)
echo "Fetching remote changes from git with git fetch"
git fetch origin "$CURRENT_BRANCH" > /dev/null 2>&1
echo "Running checks..."

git diff --shortstat --exit-code $CURRENT_BRANCH origin/$CURRENT_BRANCH > /dev/null 2>&1 || fail "   ❌ Some changes are not pulled. Run git pull!"
echo "   ✅ No incoming changes detected"

docker login -u="$JITSU_DOCKER_LOGIN" -p="$JITSU_DOCKER_PASSWORD" >/dev/null 2>&1|| fail '   ❌ Jitsu docker login failed. Make sure that JITSU_DOCKER_LOGIN and JITSU_DOCKER_PASSWORD are properly set'
echo "   ✅ Can login with jitsu docker account"

docker login -u="$KSENSE_DOCKER_LOGIN" -p="$KSENSE_DOCKER_PASSWORD" >/dev/null 2>&1|| fail '   ❌ Ksense legacy docker account login failed. Make sure that KSENSE_DOCKER_LOGIN" and KSENSE_DOCKER_PASSWORD are properly set'
echo "   ✅ Can login with ksense legacy docker account"

if [[ $CURRENT_BRANCH == "master" || $CURRENT_BRANCH == "beta" ]]; then
  echo "   ✅ Git branch is $CURRENT_BRANCH"
else
  echo "   ⚠️ Git branch $CURRENT_BRANCH is not master or beta."
fi

git diff-index --quiet HEAD || fail "   ❌ Repository has local changes. Run git diff. And commit them! (And sometimes this command fails due to cache try to re-run it)"
echo "   ✅ No local changes"

[[ -z $(git cherry) ]] || fail "   ❌ Not all changes are pushed. Please run git diff HEAD^ HEAD to see them"
echo "   ✅ No unpushed changes"

platform="linux/amd64"
if [[ $TARGET_ARCH == "arm" ]]; then
  platform="linux/arm64"
elif [[ $TARGET_ARCH == "both" ]]; then
  platform="linux/amd64,linux/arm64"
fi

if [ $# -eq 2 ]; then
  version=$1
  subsystem=$2
else
  subsystem="jitsu"
  if [[ $( git branch --show-current) == "master" ]]; then
    echo "Releasing master. Checking if HEAD is tagged"
    git describe --tags --exact-match HEAD >/dev/null 2>&1 || fail "   ❌ HEAD is not tagged. Run git describe --exact-match HEAD "
    latest_tag=$(git describe --tags --exact-match HEAD)
    version=${latest_tag//v/}
    echo "   ✅ Latest tag is $latest_tag, version is $version"
  elif [[ $( git branch --show-current) == "beta" ]]; then
    echo "Releasing beta. Target platform: $platform"
    version='beta'
  else
    echo "Releasing custom branch: $( git branch --show-current) Target platform: $platform"
    while [ -z "$version" ]; do
      read -r -p "Please provide docker image tag for the custom branch release: " version
    done
  fi
fi

chalk green "=== Release version: $version ==="

chalk green "=== Release subsystem: $subsystem ==="

case $subsystem in
    [s][e][r][v][e][r])
        build_server
        release_server $version $platform
        ;;
    [c][o][n][f][i][g][u][r][a][t][o][r])
        build_configurator
        release_configurator $version $platform
        ;;
    [j][i][t][s][u])
       build_server
       build_configurator
       release_server $version $platform
       release_configurator $version $platform
       release_jitsu $version $platform
       ;;
    *)
        echo "Invalid input service [$subsystem]..."
        exit 1
        ;;
esac
