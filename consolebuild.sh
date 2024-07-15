#!/usr/bin/env bash

docker buildx build --platform linux/amd64 . -f all.Dockerfile --target console --push -t jitsucom/console:latest