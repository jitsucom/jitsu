# Run `docker login`, use jitsucom account
# Build & push it with
#    docker buildx build --platform linux/amd64 . -f console.Dockerfile --push -t jitsucom/console:latest

FROM node:22-bookworm as base

WORKDIR /app
RUN apt-get update -y
RUN apt-get install nano curl bash netcat-traditional procps jq -y

FROM base as builder

RUN apt-get update -y
RUN apt-get install git openssl1.1 procps python3 make g++ -y
RUN npm -g install pnpm

# Create app directory
WORKDIR /app
COPY pnpm-lock.yaml .
RUN --mount=type=cache,id=onetag_pnpm,target=/root/.local/share/pnpm/store/v3 pnpm fetch

COPY . .
RUN rm .env*
RUN --mount=type=cache,id=onetag_pnpm,target=/root/.local/share/pnpm/store/v3 pnpm install -r --unsafe-perm

ENV NEXTJS_STANDALONE_BUILD=1
#Tubo cache is not working well ?
#RUN --mount=type=cache,id=onetag_turbo,target=/app/node_modules/.cache/turbo pnpm build
RUN pnpm build

FROM base as console

ARG JITSU_BUILD_VERSION=dev,
ARG JITSU_BUILD_DOCKER_TAG=dev,
ARG JITSU_BUILD_COMMIT_SHA=unknown,


WORKDIR /app
RUN npm -g install prisma@$(cat webapps/console/package.json | jq -r '.dependencies.prisma')
COPY --from=builder /app/docker-start-console.sh ./
COPY --from=builder /app/webapps/console/prisma/schema.prisma ./
COPY --from=builder /app/webapps/console/.next/standalone ./
COPY --from=builder /app/webapps/console/.next/static ./webapps/console/.next/static
COPY --from=builder /app/webapps/console/public ./webapps/console/public

EXPOSE 3000

HEALTHCHECK CMD curl --fail http://localhost:3000/api/healthcheck || exit 1

ENV NODE_ENV=production
ENV JITSU_VERSION_COMMIT_SHA=${JITSU_BUILD_COMMIT_SHA}
ENV JITSU_VERSION_DOCKER_TAG=${JITSU_BUILD_DOCKER_TAG}
ENV JITSU_VERSION_STRING=${JITSU_BUILD_VERSION}

ENTRYPOINT ["sh", "-c", "/app/docker-start-console.sh"]

FROM base as rotor

ARG JITSU_BUILD_VERSION=dev,
ARG JITSU_BUILD_DOCKER_TAG=dev,
ARG JITSU_BUILD_COMMIT_SHA=unknown,


WORKDIR /app
RUN addgroup --system --gid 1001 runner
RUN adduser --system --uid 1001 runner
USER runner

EXPOSE 3401

COPY --from=builder /app/services/rotor/dist .

ENV NODE_ENV=production
ENV JITSU_VERSION_COMMIT_SHA=${JITSU_BUILD_COMMIT_SHA}
ENV JITSU_VERSION_DOCKER_TAG=${JITSU_BUILD_DOCKER_TAG}
ENV JITSU_VERSION_STRING=${JITSU_BUILD_VERSION}

CMD ["--no-node-snapshot", "--max-old-space-size=2048", "main.js"]
