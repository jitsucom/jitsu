#!/usr/bin/env bash

pnpm run build-scripts docker ../../ -t console,rotor,profiles --platform linux/amd64,linux/arm64 --push $@

