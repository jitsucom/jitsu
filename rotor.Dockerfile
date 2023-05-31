# Run `docker login`, use jitsucom account
# Build & push it with
#    docker buildx build --platform linux/amd64 . -f rotor.Dockerfile --push -t jitsucom/rotor:latest


FROM node:16-bullseye-slim as builder

RUN apt-get update -y
RUN apt-get install nano curl git openssl1.1 procps python3 make g++ bash -y

# Create app directory
WORKDIR /app
RUN npm -g install pnpm
COPY pnpm-lock.yaml .
RUN --mount=type=cache,id=onetag_pnpm,target=/root/.local/share/pnpm/store/v3 pnpm fetch
COPY . .
RUN --mount=type=cache,id=onetag_pnpm,target=/root/.local/share/pnpm/store/v3 pnpm install -r --unsafe-perm
RUN --mount=type=cache,id=rotor_turborepo,target=/app/node_modules/.cache/turbo pnpm build --filter=@jitsu-internal/rotor


FROM node:16-bullseye-slim AS runner

WORKDIR /app
RUN addgroup --system --gid 1001 runner
RUN adduser --system --uid 1001 runner
USER runner

EXPOSE 3401


COPY --from=builder /app/services/rotor/dist .

ENTRYPOINT ["sh", "-c", "node main.js"]
