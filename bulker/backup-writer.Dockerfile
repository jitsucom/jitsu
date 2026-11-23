FROM golang:1.26-bookworm AS build
WORKDIR /src
COPY backup-writer/go.mod backup-writer/go.sum ./
RUN go mod download
COPY backup-writer/*.go ./
RUN CGO_ENABLED=0 go build -mod=readonly -o /backup-writer .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /backup-writer /usr/local/bin/backup-writer
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/backup-writer"]
