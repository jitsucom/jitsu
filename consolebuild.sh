#!/usr/bin/env bash

docker buildx build --platform linux/amd64 . -f console.Dockerfile --push -t jitsucom/console:latest