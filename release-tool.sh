#!/usr/bin/env bash


# Highlights args with color
# Only red is supported so far
#
function chalk() {
  local color=$1; shift
  local color_code=0
  if [[ $color == "red" ]]; then
    color_code=1
  fi
  echo -e "$(tput setaf $color_code)$*$(tput sgr0)"
}

function fail() {
  local error="$*" || 'Unknown error'
  echo "$(chalk red "${error}")" ; exit 1
}

function build_server() {
  echo "Building Server lib JS locally.."
  rm -rf server/build && rm -rf javascript-sdk/dist && \
  cd javascript-sdk/ && yarn clean && yarn install --prefer-offline && yarn build && cd ../server && \
  make js_release && cd ../ || { echo 'Server build failed' ; exit 1; }
}

function build_configurator() {
  echo "Building Configurator UI locally.."
  rm -f configurator/backend/build/dist/configurator && rm -rf configurator/frontend/build && \
  cd configurator/frontend/ && yarn clean && yarn install --prefer-offline && CI=false NODE_ENV=production ANALYTICS_KEYS='{"eventnative": "js.gpon6lmpwquappfl07tuq.ka5sxhsm08cmblny72tevi"}' yarn build && \
  cd ../../ || { echo 'Configurator build failed' ; exit 1; }
}

function release_server() {
  echo "**** Server amd64/arm64 release [$1] ****"
  docker login -u="$JITSU_DOCKER_LOGIN" -p="$JITSU_DOCKER_PASSWORD" || { echo "Docker jitsu ($JITSU_DOCKER_LOGIN) login failed" ; exit 1; }

  if [[ $1 =~ $SEMVER_EXPRESSION ]]; then
    docker buildx build --platform linux/amd64,linux/arm64 --push -t jitsucom/server:"$1" -t jitsucom/server:latest -f server-release.Dockerfile --build-arg dhid=jitsucom . || { echo 'Server dockerx build semver failed' ; exit 1; }

    docker login -u="$KSENSE_DOCKER_LOGIN" -p="$KSENSE_DOCKER_PASSWORD" || { echo "Docker ksense login failed" ; exit 1; }
    docker buildx build --platform linux/amd64 --push -t ksense/eventnative:"$1" -t ksense/eventnative:latest -f server-release.Dockerfile --build-arg dhid=ksense . || { echo 'ksense/eventnative dockerx build semver failed' ; exit 1; }
  else
    docker buildx build --platform linux/amd64,linux/arm64 --push -t jitsucom/server:"$1" -f server-release.Dockerfile --build-arg dhid=jitsucom  . || { echo 'Server dockerx build failed' ; exit 1; }
  fi
}

function release_configurator() {
  echo "**** Configurator amd64/arm64 release [$1] ****"
  docker login -u="$JITSU_DOCKER_LOGIN" -p="$JITSU_DOCKER_PASSWORD" || { echo 'Docker jitsu login failed' ; exit 1; }

  if [[ $1 =~ $SEMVER_EXPRESSION ]]; then
    docker buildx build --platform linux/amd64,linux/arm64 --push -t jitsucom/configurator:"$1" -t jitsucom/configurator:latest --build-arg dhid=jitsucom -f configurator-release.Dockerfile . || { echo 'Configurator dockerx build semver failed' ; exit 1; }
  else
    docker buildx build --platform linux/amd64,linux/arm64 --push -t jitsucom/configurator:"$1" --build-arg dhid=jitsucom -f configurator-release.Dockerfile . || { echo 'Configurator dockerx build failed' ; exit 1; }
  fi
}

function release_jitsu() {
  echo "**** Jitsu release [$1] ****"
  docker login -u="$JITSU_DOCKER_LOGIN" -p="$JITSU_DOCKER_PASSWORD" || { echo 'Docker jitsu login failed' ; exit 1; }

  cd docker && \
  docker pull jitsucom/configurator:"$1" && \
  docker pull jitsucom/configurator:latest && \
  docker pull jitsucom/server:"$1" && \
  docker pull jitsucom/server:latest || { echo 'Jitsu docker pull failed' ; exit 1; }

  if [[ $1 =~ $SEMVER_EXPRESSION ]]; then
    docker buildx build --platform linux/amd64,linux/arm64 --push -t jitsucom/jitsu:"$1" -t jitsucom/jitsu:latest --build-arg dhid=jitsu --build-arg SRC_VERSION=latest . || { echo 'Jitsu dockerx build semver failed' ; exit 1; }
  else
    docker buildx build --platform linux/amd64,linux/arm64 --push -t jitsucom/jitsu:"$1" --build-arg dhid=jitsu --build-arg SRC_VERSION=beta . || { echo 'Jitsu dockerx build failed' ; exit 1; }
  fi

  cd ../
}


SEMVER_EXPRESSION='^([0-9]+\.){0,2}(\*|[0-9]+)$'
echo "Release tool running..."
echo "Running checks:"
docker login -u="$JITSU_DOCKER_LOGIN" -p="$JITSU_DOCKER_PASSWORD" >/dev/null 2>&1|| fail 'Docker jitsu login failed. Make sure that JITSU_DOCKER_LOGIN and JITSU_DOCKER_PASSWORD are properly'
echo "   ✅ Can login with docker"
git status --porcelain >/dev/null 2>&1 && fail "   ❌ Repository has local changes. Run git diff. And commit them first"

if [ $# -eq 2 ]
  then
    version=$1
    subsystem=$2
  else
    read -r -p "What version would you like to release? ['beta' or release as semver, e. g. '1.30.1' ] " version
fi

chalk green "=== Release version: $version ==="

if [[ $version =~ $SEMVER_EXPRESSION ]]; then
  echo "Checkouting master ..."
  git checkout master
  git pull
  echo "Service to release: configurator, server, jitsu"
  subsystem='jitsu'
elif [[ $version == "beta" ]]; then
  echo "Checkouting beta ..."
  git checkout beta
  git pull
  if [ -z "$subsystem" ]
  then
    read -r -p "What service would you like to release? ['server', 'configurator', 'jitsu']: " subsystem
  fi
else
  echo "Invalid version: $version. Only 'beta' or certain version e.g. '1.30.1' are supported"
  exit 1
fi

chalk green "=== Release subsystem: $subsystem ==="

case $subsystem in
    [s][e][r][v][e][r])
        build_server
        release_server $version
        ;;
    [c][o][n][f][i][g][u][r][a][t][o][r])
        build_configurator
        release_configurator $version
        ;;
    [j][i][t][s][u])
       build_server
       build_configurator
       release_server $version
       release_configurator $version
       release_jitsu $version
       ;;
    *)
        echo "Invalid input service [$subsystem]..."
        exit 1
        ;;
esac