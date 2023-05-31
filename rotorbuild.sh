#!/usr/bin/env bash

docker buildx build --platform linux/amd64 . -f rotor.Dockerfile --load -t jitsucom/rotor:latest