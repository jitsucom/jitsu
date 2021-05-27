function build_server() {
  echo "Building Server lib JS locally.."
  rm -f server/build && rm -rf javascript/dist && rm -rf server/web/dist && \
  cd javascript-sdk/ && yarn clean && yarn install --prefer-offline && yarn build && cd ../server && \
  while [ ! -f ../javascript-sdk/dist/web/lib.js ]; do sleep 1; done
  make js_release && cd ../
}

function build_configurator() {
  echo "Building Configurator UI locally.."
  rm -f configurator/backend/build/dist/configurator && \
  cd configurator/frontend/ && yarn clean && yarn install --prefer-offline && CI=false NODE_ENV=production ANALYTICS_KEYS='{"eventnative": "js.gpon6lmpwquappfl07tuq.ka5sxhsm08cmblny72tevi"}' yarn build && \
  cd ../../
}

function release_server() {
  echo "**** Server amd64/arm64 release [$1] ****"
  if [[ $1 =~ $SEMVER_EXPRESSION ]]; then
    docker buildx build --platform linux/amd64,linux/arm64 --push -t jitsucom/server:"$1" -t jitsucom/server:latest -f server-release.Dockerfile --build-arg dhid=jitsucom .
  else
    docker buildx build --platform linux/amd64,linux/arm64 --push -t jitsucom/server:"$1" -f server-release.Dockerfile --build-arg dhid=jitsucom  .
  fi
}

function release_configurator() {
  echo "**** Configurator amd64/arm64 release [$1] ****"
  if [[ $1 =~ $SEMVER_EXPRESSION ]]; then
    docker buildx build --platform linux/amd64,linux/arm64 --push -t jitsucom/configurator:"$1" -t jitsucom/configurator:latest --build-arg dhid=jitsucom -f configurator-release.Dockerfile .
  else
    docker buildx build --platform linux/amd64,linux/arm64 --push -t jitsucom/configurator:"$1" --build-arg dhid=jitsucom -f configurator-release.Dockerfile .
  fi
}

function release_heroku() {
  echo "**** Heroku release ****"
  cd heroku && \
  docker build -t jitsucom/heroku -f heroku.Dockerfile . && \
  docker push jitsucom/heroku && \
  cd ../
}


SEMVER_EXPRESSION='^([0-9]+\.){0,2}(\*|[0-9]+)$'
echo "Release tool running..."
echo ""
read -r -p "What version would you like to release? ['beta', certain version e.g. '1.30.1' ] Note: latest version has been released with certain version by default: " version

echo "Release version: $version"

if [[ $version =~ $SEMVER_EXPRESSION ]]; then
 echo "Service to release: all"
 subsystem='all'
elif [[ $version == "beta" ]]; then
  read -r -p "What service would you like to release? ['server', 'configurator', 'all', 'heroku']: " subsystem
else
  echo "Invalid version: $version. Only 'beta' or certain version e.g. '1.30.1' are supported"
  exit 1
fi

case $subsystem in
    [h][e][r][o][k][u])
        build_server
        build_configurator
        release_server $version
        release_configurator $version
        release_heroku
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
       release_heroku
       ;;
    *)
        echo "Invalid input service [$subsystem]..."
        exit 1
        ;;
esac