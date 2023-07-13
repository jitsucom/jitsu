#!/usr/bin/env bash

docker buildx build --platform linux/amd64 . -f rotor.Dockerfile --push -t jitsucom/rotor:latest