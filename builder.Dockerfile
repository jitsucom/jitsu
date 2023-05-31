#Docker image for building the application
#It installs all dependencies which speeds up CI builds.
#Dependencies are: node, pnpm and playwright

# Run `docker login`
# Build & push it with
#    docker buildx build --platform linux/amd64 . -f builder.Dockerfile --push -t jitsucom/node16builder:latest

FROM debian:bullseye-slim
RUN apt-get update
# Telnet is useful for debugging, and we need curl for Node 16
RUN apt-get install git curl telnet python3 g++ make -y
RUN curl -sL https://deb.nodesource.com/setup_16.x | bash -
#We need bash for pnpm setup
RUN apt-get install nodejs bash -y


RUN npm -g install pnpm
RUN npm install --global playwright@1.31.2
RUN playwright install --with-deps
