#Docker image for building the application
#It installs all dependencies which speeds up CI builds.
#Dependencies are: node, pnpm and playwright

# Run `docker login`
# Build & push it with
#    docker buildx build --platform linux/amd64 . -f builder.Dockerfile --push -t jitsucom/node22builder:latest

FROM node:22-bookworm
RUN apt-get update
# Telnet is useful for debugging, and we need curl for Node
RUN apt-get install git curl telnet python3 ca-certificates gnupg g++ make -y

RUN npm -g install pnpm

#Should be the same as playwrite version in ./libs/jitsu-js/package.json
RUN npm install --global playwright@1.39.0
RUN playwright install --with-deps
