FROM golang:1.26-bookworm as build

RUN apt-get install gcc libc6-dev

RUN mkdir /app
WORKDIR /app

RUN mkdir jitsubase sync-sidecar

COPY jitsubase/go.* ./jitsubase/
COPY bulkerlib/go.* ./bulkerlib/
COPY sync-sidecar/go.* ./sync-sidecar/

RUN go work init jitsubase bulkerlib sync-sidecar

WORKDIR /app/sync-sidecar

RUN go mod download

WORKDIR /app

COPY . .

# Build bulker
RUN go build -o sidecar ./sync-sidecar

#######################################
# FINAL STAGE
FROM debian:bookworm-slim as final

RUN apt-get update -y
RUN apt-get install -y ca-certificates curl

ENV TZ=UTC

RUN mkdir /app
WORKDIR /app

# Copy bulkerapp
COPY --from=build /app/sidecar ./

CMD ["/app/sidecar"]
