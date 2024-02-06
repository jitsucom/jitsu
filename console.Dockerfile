# Run `docker login`, use jitsucom account
# Build & push it with
#    docker buildx build --platform linux/amd64 . -f console.Dockerfile --push -t jitsucom/console:latest

FROM node:18-slim as base

RUN apt-get update -y
RUN apt-get install nano curl bash netcat-traditional jq -y

FROM base as builder

RUN apt-get update -y
RUN apt-get install git openssl1.1 procps python3 make g++ -y
RUN npm -g install pnpm

# Create app directory
WORKDIR /app
COPY pnpm-lock.yaml .
RUN --mount=type=cache,id=onetag_pnpm,target=/root/.local/share/pnpm/store/v3 pnpm fetch
COPY . .
RUN --mount=type=cache,id=onetag_pnpm,target=/root/.local/share/pnpm/store/v3 pnpm install -r --unsafe-perm
RUN --mount=type=cache,id=console_turborepo,target=/app/node_modules/.cache/turbo pnpm build
RUN export NEXTJS_STANDALONE_BUILD=1 && pnpm build
RUN rm .env*

FROM base as runner

WORKDIR /app
RUN npm -g install prisma@$(cat webapps/console/package.json | jq -r '.dependencies.prisma')
COPY --from=builder /app/docker-start-console.sh ./
COPY --from=builder /app/webapps/console/prisma/schema.prisma ./
COPY --from=builder /app/webapps/console/.next/standalone ./
COPY --from=builder /app/webapps/console/.next/static ./webapps/console/.next/static
COPY --from=builder /app/webapps/console/public ./webapps/console/public


EXPOSE 3000

HEALTHCHECK CMD curl --fail http://localhost:3000/api/healthcheck || exit 1

ENTRYPOINT ["sh", "-c", "/app/docker-start-console.sh"]
