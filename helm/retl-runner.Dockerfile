# Dev-only image: build the self-contained Node bundle with build-retl-runner.sh.
# The build context is services/retl-runner/dist, never the checkout or its .env files.
FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node main.cjs /app/main.cjs
USER node
CMD ["node", "/app/main.cjs"]
