#!/usr/bin/env bash

function fail() {
  echo $*
  exit 1
}

[ -z "$(cat ./src/track.js | grep alert)" ] || fail "ERROR: ./src/track.js contains alert() call, cannot build that!"

mkdir -p ./build && \
./node_modules/rollup/dist/bin/rollup -c rollup.config.js && \
./node_modules/@babel/cli/bin/babel.js ./src/inline.js --out-file ./build/inline.int.js  && \
./node_modules/uglify-js/bin/uglifyjs -O max_line_len=160  ./build/inline.int.js > ./build/inline.js && \
cp ./welcome.html ./build
