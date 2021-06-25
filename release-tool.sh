#!/usr/bin/env bash

function build_server() {
  echo "Building Server lib JS locally.."
  rm -rf server/build && rm -rf javascript/dist && rm -rf server/web/dist && \
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
  docker login -u="$JITSU_DOCKER_LOGIN" -p="$JITSU_DOCKER_PASSWORD" || { echo 'Docker jitsu login failed' ; exit 1; }

  if [[ $1 =~ $SEMVER_EXPRESSION ]]; then
    docker buildx build --platform linux/amd64,linux/arm64 --push -t jitsucom/server:"$1" -t jitsucom/server:latest -f server-release.Dockerfile --build-arg dhid=jitsucom . || { echo 'Server dockerx build semver failed' ; exit 1; }

    docker login -u="$KSENSE_DOCKER_LOGIN" -p="$KSENSE_DOCKER_PASSWORD" || { echo 'Docker ksense login failed' ; exit 1; }
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

  jitsu_tags="-t jitsucom/jitsu:$1"
  if [[ $1 =~ $SEMVER_EXPRESSION ]]; then
    jitsu_tags="-t jitsucom/jitsu:$1 -t jitsucom/jitsu:latest"
  fi

  cd docker && \
  docker pull jitsucom/configurator:"$1" && \
  docker pull jitsucom/configurator:latest && \
  docker pull jitsucom/server:"$1" && \
  docker pull jitsucom/server:latest && \
  docker build $jitsu_tags . && \
  cd ../ || { echo 'Jitsu docker build failed' ; exit 1; }

  docker push jitsucom/jitsu:"$1"  || { echo 'Jitsu docker push failed' ; exit 1; }

  if [[ $1 =~ $SEMVER_EXPRESSION ]]; then
    docker push jitsucom/jitsu:latest  || { echo 'Jitsu latest docker push failed' ; exit 1; }
  fi
}


SEMVER_EXPRESSION='^([0-9]+\.){0,2}(\*|[0-9]+)$'
echo "Release tool running..."
echo ""
read -r -p "What version would you like to release? ['beta' or release as semver, e. g. '1.30.1' ] " version

echo "Release version: $version"

if [[ $version =~ $SEMVER_EXPRESSION ]]; then
  echo "Checkouting master ..."
  git checkout master
  echo "Using git reset --hard"
  git reset --hard
  git pull
  echo "Service to release: all"
  subsystem='all'
elif [[ $version == "beta" ]]; then
  echo "Checkouting beta ..."
  git checkout beta
  echo "Using git reset --hard"
  git reset --hard
  git pull
  read -r -p "What service would you like to release? ['server', 'configurator', 'all', 'jitsu']: " subsystem
else
  echo "Invalid version: $version. Only 'beta' or certain version e.g. '1.30.1' are supported"
  exit 1
fi

case $subsystem in
    [j][i][t][s][u])
        release_jitsu
        ;;
    [s][e][r][v][e][r])
        build_server
        release_server $version
        ;;
    [c][o][n][f][i][g][u][r][a][t][o][r])
        build_configurator
        release_configurator $version
        ;;
    [a][l][l])
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