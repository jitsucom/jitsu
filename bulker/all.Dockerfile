FROM debian:bookworm-slim as base

RUN apt-get update -y
RUN apt-get install -y ca-certificates curl

ENV TZ=UTC

WORKDIR /app

FROM golang:1.26-bookworm as builder

ARG VERSION
ENV VERSION $VERSION
ARG BUILD_TIMESTAMP
ENV BUILD_TIMESTAMP $BUILD_TIMESTAMP

RUN apt-get install gcc libc6-dev

WORKDIR /app

RUN mkdir jitsubase kafkabase eventslog bulkerlib bulkerapp ingest sync-sidecar sync-controller operator ingress-manager config-keeper admin reprocessing-worker
RUN mkdir connectors connectors/airbytecdk connectors/firebase

COPY jitsubase/go.* ./jitsubase/
COPY kafkabase/go.* ./kafkabase/
COPY eventslog/go.* ./eventslog/
COPY bulkerlib/go.* ./bulkerlib/
COPY bulkerapp/go.* ./bulkerapp/
COPY ingest/go.* ./ingest/
COPY sync-sidecar/go.* ./sync-sidecar/
COPY sync-controller/go.* ./sync-controller/
COPY operator/go.* ./operator/
COPY ingress-manager/go.* ./ingress-manager/
COPY config-keeper/go.* ./config-keeper/
COPY admin/go.* ./admin/
COPY reprocessing-worker/go.* ./reprocessing-worker/
COPY connectors/airbytecdk/go.* ./connectors/airbytecdk/
COPY connectors/firebase/go.* ./connectors/firebase/
COPY go.work ./go.work
COPY go.work.sum ./go.work.sum

#RUN go work init jitsubase kafkabase eventslog bulkerlib bulkerapp ingest sync-sidecar sync-controller
RUN --mount=type=cache,id=go_mod,mode=0755,target=/go/pkg/mod go mod download

WORKDIR /app

COPY . .

RUN --mount=type=cache,id=go_mod,mode=0755,target=/go/pkg/mod go build -ldflags="-X main.Commit=$VERSION -X main.Timestamp=$BUILD_TIMESTAMP" -o bulker ./bulkerapp
RUN --mount=type=cache,id=go_mod,mode=0755,target=/go/pkg/mod go build -ldflags="-X main.Commit=$VERSION -X main.Timestamp=$BUILD_TIMESTAMP" -o ingest ./ingest
RUN --mount=type=cache,id=go_mod,mode=0755,target=/go/pkg/mod go build -ldflags="-X main.Commit=$VERSION -X main.Timestamp=$BUILD_TIMESTAMP" -o sidecar ./sync-sidecar
RUN --mount=type=cache,id=go_mod,mode=0755,target=/go/pkg/mod go build -ldflags="-X main.Commit=$VERSION -X main.Timestamp=$BUILD_TIMESTAMP" -o syncctl ./sync-controller
RUN --mount=type=cache,id=go_mod,mode=0755,target=/go/pkg/mod go build -ldflags="-X main.Commit=$VERSION -X main.Timestamp=$BUILD_TIMESTAMP" -o operator ./operator
RUN --mount=type=cache,id=go_mod,mode=0755,target=/go/pkg/mod go build -ldflags="-X main.Commit=$VERSION -X main.Timestamp=$BUILD_TIMESTAMP" -o ingmgr ./ingress-manager
RUN --mount=type=cache,id=go_mod,mode=0755,target=/go/pkg/mod go build -ldflags="-X main.Commit=$VERSION -X main.Timestamp=$BUILD_TIMESTAMP" -o cfgkpr ./config-keeper
RUN --mount=type=cache,id=go_mod,mode=0755,target=/go/pkg/mod go build -ldflags="-X main.Commit=$VERSION -X main.Timestamp=$BUILD_TIMESTAMP" -o admin ./admin
RUN --mount=type=cache,id=go_mod,mode=0755,target=/go/pkg/mod go build -ldflags="-X main.Commit=$VERSION -X main.Timestamp=$BUILD_TIMESTAMP" -o reprocessing-worker ./reprocessing-worker

FROM base as bulker

COPY --from=builder /app/bulker ./
CMD ["/app/bulker"]

FROM base as ingest

COPY --from=builder /app/ingest/ingest ./
CMD ["/app/ingest"]

FROM base as sidecar

COPY --from=builder /app/sidecar ./
CMD ["/app/sidecar"]

FROM base as syncctl

COPY --from=builder /app/syncctl ./
CMD ["/app/syncctl"]

FROM base as operator

COPY --from=builder /app/operator ./
CMD ["/app/operator"]

FROM base as ingmgr

COPY --from=builder /app/ingmgr ./
CMD ["/app/ingmgr"]

FROM base as cfgkpr

COPY --from=builder /app/cfgkpr ./
CMD ["/app/cfgkpr"]

FROM base as admin

COPY --from=builder /app/admin ./
CMD ["/app/admin"]

FROM base as reprocessing-worker

COPY --from=builder /app/reprocessing-worker ./
CMD ["/app/reprocessing-worker"]
