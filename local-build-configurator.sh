#!/usr/bin/env bash

ARM_BUILD='GOARCH=arm64'
AMD_BUILD='GOARCH=amd64'
GO_BUILD_PARAMS=''

arch_flag='amd'
docker_flag='true'

print_usage() {
  echo "Jitsu Configurator Building CLI usage:"
  echo "./local-build-configurator.sh --arch [amd, arm] --docker [true, false]"
  echo " "
  echo "options:"
  echo "-h, --help                show brief help"
  echo "-a, --arch                specify an architecture for builg go:"
  echo "                          -a amd: (default) build go with GOARCH=amd64 parameters for x86"
  echo "                          -a arm: build go with GOARCH=arm64 parameters for arm"
  echo "-d, --docker              specify should CLI build docker image or not:"
  echo "                          -d true: (default) build binaries and docker image"
  echo "                          -d false: build only binaries"
}

while test $# -gt 0; do
  case "$1" in
    -h|--help)
      print_usage
      exit 0
      ;;
    -a|--arch)
      shift
      if test $# -gt 0; then
        export arch_flag=$1
      else
        echo "default architecture: $arch_flag"
      fi
      shift
      ;;
    -d|--docker)
      shift
      if test $# -gt 0; then
        export docker_flag=$1
      else
        echo "default build docker: $docker_flag"
      fi
      shift
      ;;
    *)
      break
      ;;
  esac
done

if [ "$arch_flag" == 'arm' ]
then
  GO_BUILD_PARAMS="$ARM_BUILD"
else
  GO_BUILD_PARAMS="$AMD_BUILD"
fi

echo ""
echo "============================================"
echo "=    Building go Configurator backend...   ="
echo "============================================"
echo ""

(cd configurator/backend; rm -rf build && make all GOBUILD_PREFIX="$GO_BUILD_PARAMS") || { echo 'Building go configurator backend failed' ; exit 1; }


echo ""
echo "============================================"
echo "=         Building Configurator UI...      ="
echo "============================================"
echo ""

(cd configurator/frontend; rm -rf main/build && yarn clean && CI=false ANALYTICS_KEYS='{"eventnative": "js.gpon6lmpwquappfl07tuq.ka5sxhsm08cmblny72tevi", "sentry": "https://5d29508173c04d86b31638517ebf89b3@o330694.ingest.sentry.io/6365760"}' yarn build) || { echo 'Building Configurator UI failed' ; exit 1; }

echo ""
echo "============================================"
echo "=          Packaging Configurator...       ="
echo "============================================"
echo ""

(cd configurator; rm -rf build/dist && mkdir -p build/dist/web; cp -r frontend/main/build/* build/dist/web/; cp backend/build/dist/* build/dist/) || { echo 'Packaging UI failed' ; exit 1; }


if [ "$docker_flag" == 'true' ]
then
  echo ""
  echo "============================================"
  echo "= Building jitsucom/configurator docker... ="
  echo "============================================"
  echo ""

  docker build -t jitsucom/configurator -f configurator-release.Dockerfile --build-arg dhid=jitsucom . || { echo 'Building jitsucom/configurator docker failed' ; exit 1; }
fi

echo ""
echo "============================================"
echo "=            SUCCESSFUL BUILD              ="
echo "============================================"
echo ""