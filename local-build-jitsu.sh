#!/usr/bin/env bash

only_jitsu_flag='false'

print_usage() {
  echo "Jitsu Building CLI usage:"
  echo "./local-build-jitsu.sh --only_jitsu [true, false]"
  echo " "
  echo "options:"
  echo "-h, --help                show brief help"
  echo "-oj, --only_jitsu         specify should CLI build only jitsucom/jitsu docker. By default CLI builds jitsucom/server, jitsucom/configurator and jitsucom/jitsu images"
  echo "                          -oj true: build only jitsucom/jitsu"
  echo "                          -oj false: (default) build all 3 docker images: jitsucom/server, jitsucom/configurator, jitsucom/jitsu"
}

while test $# -gt 0; do
  case "$1" in
    -h|--help)
      print_usage
      exit 0
      ;;
    -oj|--only_jitsu)
      shift
      if test $# -gt 0; then
        export only_jitsu_flag=$1
      else
        echo "default only_jitsu: $only_jitsu_flag"
      fi
      shift
      ;;
    *)
      break
      ;;
  esac
done


if [ "$only_jitsu_flag" == 'false' ]
then
  ./local-build-server.sh || { echo './local-build-server failed' ; exit 1; }
  ./local-build-configurator.sh || { echo './local-build-configurator failed' ; exit 1; }
fi

echo ""
echo "============================================"
echo "=    Building jitsucom/jitsu docker...     ="
echo "============================================"
echo ""

(cd docker; docker build -t jitsucom/jitsu .) || { echo 'Building jitsucom/jitsu docker failed' ; exit 1; }

echo ""
echo "============================================"
echo "=            SUCCESSFUL BUILD              ="
echo "============================================"
echo ""