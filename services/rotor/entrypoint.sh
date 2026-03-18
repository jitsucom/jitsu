#!/bin/sh

if [ "$ROTOR_MODE" = "functions" ]; then
    echo "Running in function-server mode (Deno)"
    exec deno run \
      --allow-net \
      --allow-read \
      --allow-write=/tmp/jitsu-udf \
      --allow-env \
      --allow-sys \
      --allow-ffi \
      --allow-run=/app/node_modules/@esbuild/linux-arm64/bin/esbuild,/app/node_modules/@esbuild/linux-x64/bin/esbuild,/app/node_modules/esbuild/bin/esbuild \
      --unstable-worker-options \
      --no-check \
      functions-server.mjs
else
    echo "Running in default mode"
    exec node --no-node-snapshot --max-old-space-size=2048 main.js
fi
