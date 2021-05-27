SEMVER_EXPRESSION='^([0-9]+\.){0,2}(\*|[0-9]+)$'
echo "Release tool running..."
echo ""
read -r -p "What service would you like to release? ['server', 'configurator', 'both']: " subsystem

echo ""
read -r -p "What version would you like to release? ['beta', certain version e.g. '1.30.1' ] Note: latest version has been released with certain version by default: " version

if [[ $version =~ $SEMVER_EXPRESSION ]] || [[ $version = "beta" ]]; then
 echo "Release version: $version"
else
  echo "Invalid version: $version. Only 'beta' or certain version e.g. '1.30.1' are supported"
  exit 1
fi

case $subsystem in
    [s][e][r][v][e][r])
        build_server
        release_server version
        ;;
    [c][o][n][f][i][g][u][r][a][t][o][r])
        build_configurator
        release_configurator version
        ;;
    [b][o][t][h])
       build_server
       build_configurator
       release_server version
       release_configurator version
        ;;
    *)
        echo "Invalid input service..."
        exit 1
        ;;
esac

function build_server() {
  echo "Building Server JS locally.."
  rm server/build/dist/eventnative && \
  cd javascript-sdk/ && yarn clean && yarn install && yarn build
}

function build_configurator() {
  echo "Building Configurator JS locally.."
  rm configurator/backend/build/dist/configurator && \
  cd ../frontend/ && yarn clean && yarn install && CI=false NODE_ENV=production ANALYTICS_KEYS='{"eventnative": "js.gpon6lmpwquappfl07tuq.ka5sxhsm08cmblny72tevi"}' yarn build
}

function release_server() {
  echo "**** Server amd64/arm64 release [$1] ****"
  tag_part="-t jitsucom/server:$1"
  if [[ $1 =~ $SEMVER_EXPRESSION ]]; then
    tag_part="-t jitsucom/server:$1 -t jitsucom/server:latest"
  fi

  docker buildx build --platform linux/amd64,linux/arm64 --push "$tag_part" --build-arg dhid=jitsucom -f server-release.Dockerfile .
}

function release_configurator() {
  echo "**** Configurator amd64/arm64 release [$1] ****"
  tag_part="-t jitsucom/configurator:$1"
  if [[ $1 =~ $SEMVER_EXPRESSION ]]; then
    tag_part="-t jitsucom/configurator:$1 -t jitsucom/configurator:latest"
  fi
  docker buildx build --platform linux/amd64,linux/arm64 --push "$tag_part" --build-arg dhid=jitsucom -f configurator-release.Dockerfile .
}