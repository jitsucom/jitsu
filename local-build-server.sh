#!/usr/bin/env bash

ARM_BUILD='GOARCH=arm64'
AMD_BUILD='GOARCH=amd64'
GO_BUILD_PARAMS=''
SDK_VERSION='latest'

arch_flag='amd'
docker_flag='true'

print_usage() {
  echo "Jitsu Server Building CLI usage:"
  echo "./local-build-server.sh --arch [amd, arm] --docker [true, false]"
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
    -s|--sdk)
      shift
      if test $# -gt 0; then
        export SDK_VERSION=$1
      else
        echo "default js sdk version: $SDK_VERSION"
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
echo "====================================="
echo "=    Downloading javascript sdk...  ="
echo "====================================="
echo ""

(rm -rf javascript-sdk && mkdir -p javascript-sdk && curl -o javascript-sdk/lib.js https://unpkg.com/@jitsu/sdk-js@$SDK_VERSION/dist/web/lib.js) || { echo 'Building javascript sdk failed' ; exit 1; }

echo ""
echo "====================================="
echo "=       Building go Server...       ="
echo "====================================="
echo ""

(cd server; make all GOBUILD_PREFIX="$GO_BUILD_PARAMS") || { echo 'Building go Server failed' ; exit 1; }

if [ "$docker_flag" == 'true' ]
then
  echo ""
  echo "====================================="
  echo "= Building jitsucom/server docker.. ="
  echo "====================================="
  echo ""

  docker build -t jitsucom/server -f server.Dockerfile --build-arg dhid=jitsucom --build-arg SDK_VERSION=$SDK_VERSION . || { echo 'Building jitsucom/server docker failed' ; exit 1; }
fi

echo ""
echo "====================================="
echo "=        SUCCESSFUL BUILD           ="
echo "====================================="
echo ""