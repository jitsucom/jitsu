#!/bin/sh

if [ "$ROTOR_MODE" = "functions" ]; then
    echo "Running in function-server mode"
    exec node --no-node-snapshot --max-old-space-size=2048 functions-server.js
else
    echo "Running in default mode"
    exec node --no-node-snapshot --max-old-space-size=2048 main.js
fi
