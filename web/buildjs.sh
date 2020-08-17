#!/usr/bin/env sh

mkdir -p ./build && \
./node_modules/rollup/dist/bin/rollup -c rollup.config.js && \
./node_modules/@babel/cli/bin/babel.js ./src/inline.js --out-file ./build/inline.int.js  && \
./node_modules/uglify-js/bin/uglifyjs -O max_line_len=160  ./build/inline.int.js > ./build/inline.js && \
cp ./welcome.html ./build
