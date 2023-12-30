# Run `docker login`, use jitsucom account
# Build & push it with
#    docker buildx build --platform linux/amd64 . -f console.Dockerfile --push -t jitsucom/console:latest


FROM node:18-slim as base

WORKDIR /app
RUN apt-get update
#those commands are used in docker-start-console.sh
RUN apt-get install curl bash netcat-traditional -y


FROM base as builder-base
#Global dependencies required for building the project
RUN npm -g install pnpm


FROM builder-base as dependency-downloader

WORKDIR /app
RUN npm -g install pnpm
COPY pnpm-lock.yaml .
RUN --mount=type=cache,id=onetag_pnpm,target=/root/.local/share/pnpm/store/v3 pnpm fetch



FROM dependency-downloader as builder

COPY . .
RUN rm .env*
RUN pnpm install --frozen-lockfile
RUN pnpm build


FROM builder as release

#Delete all dependencies except production
RUN pnpm prune --prod


EXPOSE 3000

HEALTHCHECK CMD curl --fail http://localhost:3000/api/healthcheck || exit 1

ENTRYPOINT ["sh", "-c", "./docker-start-console.sh"]
