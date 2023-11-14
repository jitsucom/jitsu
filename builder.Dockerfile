#Docker image for building the application
#It installs all dependencies which speeds up CI builds.
#Dependencies are: node, pnpm and playwright

# Run `docker login`
# Build & push it with
#    docker buildx build --platform linux/amd64 . -f builder.Dockerfile --push -t jitsucom/node18builder:latest

FROM debian:bullseye-slim
RUN apt-get update
# Telnet is useful for debugging, and we need curl for Node 16
RUN apt-get install git curl telnet python3 ca-certificates gnupg g++ make -y

#Install node 18, see https://github.com/nodesource/distributions#debian-and-ubuntu-based-distributions
RUN mkdir -p /etc/apt/keyrings
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
RUN echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_18.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
RUN apt-get update

#We need bash for pnpm setup
RUN apt-get install nodejs bash -y

RUN npm -g install pnpm

#Should be the same as playwrite version in ./libs/jitsu-js/package.json
RUN npm install --global playwright@1.39.0
RUN playwright install --with-deps
