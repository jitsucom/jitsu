# Run `docker login`, use jitsucom account
# Build & push it with
#    docker buildx build --platform linux/amd64 . -f console.Dockerfile --push -t jitsucom/console:latest


FROM node:16-bullseye-slim as builder

RUN apt-get update -y
RUN apt-get install nano curl git openssl1.1 procps python3 make g++ bash netcat -y

# Create app directory
WORKDIR /app
RUN npm -g install pnpm
COPY pnpm-lock.yaml .
RUN --mount=type=cache,id=onetag_pnpm,target=/root/.local/share/pnpm/store/v3 pnpm fetch
COPY . .
RUN --mount=type=cache,id=onetag_pnpm,target=/root/.local/share/pnpm/store/v3 pnpm install -r --unsafe-perm
RUN --mount=type=cache,id=console_turborepo,target=/app/node_modules/.cache/turbo pnpm build
#RUN pnpm build

#Remove env files to prevent accidental leaks of credentials
RUN rm .env*


#FROM node:16-bullseye-slim AS runner
#RUN apt-get install bash
#RUN npm -g install pnpm
#WORKDIR /app
#RUN addgroup --system --gid 1001 runner
#RUN adduser --system --uid 1001 runner
#USER runner
#
#COPY --from=builder /app/ .

EXPOSE 3000

HEALTHCHECK CMD curl --fail http://localhost:3000/api/healthcheck || exit 1

ENTRYPOINT ["sh", "-c", "./docker-start-console.sh"]
