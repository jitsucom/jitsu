FROM debian:bullseye-slim as main

RUN apt-get update -y
RUN apt-get install -y ca-certificates curl

ENV TZ=UTC

FROM golang:1.26-bullseye as build

ARG VERSION
ENV VERSION $VERSION
ARG BUILD_TIMESTAMP
ENV BUILD_TIMESTAMP $BUILD_TIMESTAMP

RUN apt-get install gcc libc6-dev

#RUN wget -qO - https://packages.confluent.io/deb/7.2/archive.key | apt-key add -
#RUN echo "deb https://packages.confluent.io/deb/7.2 stable main"  > /etc/apt/sources.list.d/backports.list
#RUN echo "deb https://packages.confluent.io/clients/deb buster main" > /etc/apt/sources.list.d/backports.list
#RUN apt-get update
#RUN apt-get install -y librdkafka1 librdkafka-dev

RUN mkdir /app
WORKDIR /app

RUN mkdir jitsubase kafkabase eventslog ingest

COPY jitsubase/go.* ./jitsubase/
COPY kafkabase/go.* ./kafkabase/
COPY eventslog/go.* ./eventslog/
COPY ingest/go.* ./ingest/

RUN go work init jitsubase kafkabase eventslog ingest

WORKDIR /app/ingest

RUN go mod download

WORKDIR /app

COPY . .

# Build ingest
RUN go build -ldflags="-X main.Commit=$VERSION -X main.Timestamp=$BUILD_TIMESTAMP" -o ingest ./ingest

#######################################
# FINAL STAGE
FROM main as final

RUN mkdir /app
WORKDIR /app

# Copy ingest
COPY --from=build /app/ingest ./
#COPY ./config.yaml ./

CMD ["/app/ingest"]
