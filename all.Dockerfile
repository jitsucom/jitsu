# Run `docker login`, use jitsucom account
# Build & push it with
#    docker buildx build --platform linux/amd64 . -f console.Dockerfile --push -t jitsucom/console:latest

FROM node:18-slim as base

WORKDIR /app
RUN apt-get update -y
RUN apt-get install nano curl bash netcat-traditional procps jq -y

FROM base as builder

RUN apt-get update -y
RUN apt-get install git openssl1.1 procps python3 make g++ -y
RUN npm -g install pnpm


FROM builder as installer
# Create app directory
WORKDIR /app
COPY pnpm-lock.yaml .
RUN --mount=type=cache,id=onetag_pnpm,target=/root/.local/share/pnpm/store/v3 pnpm fetch

FROM installer as builder

COPY . .
RUN rm .env*
RUN --mount=type=cache,id=jitsu_pnpm,target=/root/.local/share/pnpm/store/v3 pnpm install -r --unsafe-perm
ENV NEXTJS_STANDALONE_BUILD=1
#Tubo cache is not working well....
#RUN --mount=type=cache,id=jitsu_turbo,target=/app/node_modules/.cache/turbo pnpm build
RUN pnpm build

FROM base as console

WORKDIR /app
RUN npm -g install prisma@$(cat webapps/console/package.json | jq -r '.dependencies.prisma')
COPY --from=builder /app/docker-start-console.sh ./
COPY --from=builder /app/webapps/console/prisma/schema.prisma ./
COPY --from=builder /app/webapps/console/.next/standalone ./
COPY --from=builder /app/webapps/console/.next/static /app/webapps/console/.next/standalone/webapps/console/.next/static
COPY --from=builder /app/webapps/console/public /app/webapps/console/.next/standalone/webapps/console/public

EXPOSE 3000

HEALTHCHECK CMD curl --fail http://localhost:3000/api/healthcheck || exit 1

ENTRYPOINT ["sh", "-c", "/app/docker-start-console.sh"]

FROM base as rotor

WORKDIR /app
RUN addgroup --system --gid 1001 runner
RUN adduser --system --uid 1001 runner
USER runner

EXPOSE 3401


COPY --from=builder /app/services/rotor/dist .

ENV NODE_ENV=production

ENTRYPOINT ["sh", "-c", "node --max-old-space-size=4096 main.js"]
