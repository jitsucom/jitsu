FROM debian:bullseye-slim as main

RUN apt-get update -y
RUN apt-get install -y ca-certificates curl

ENV TZ=UTC

FROM golang:1.26-bullseye as build

RUN apt-get install gcc libc6-dev

#RUN wget -qO - https://packages.confluent.io/deb/7.2/archive.key | apt-key add -
#RUN echo "deb https://packages.confluent.io/deb/7.2 stable main"  > /etc/apt/sources.list.d/backports.list
#RUN echo "deb https://packages.confluent.io/clients/deb buster main" > /etc/apt/sources.list.d/backports.list
#RUN apt-get update
#RUN apt-get install -y librdkafka1 librdkafka-dev

RUN mkdir /app
WORKDIR /app

RUN mkdir jitsubase bulkerlib bulkerapp sync-controller sync-sidecar


COPY jitsubase/go.* ./jitsubase/
COPY bulkerlib/go.* ./bulkerlib/
COPY bulkerapp/go.* ./bulkerapp/
COPY sync-controller/go.* ./sync-controller/
COPY sync-sidecar/go.* ./sync-sidecar/


RUN go work init jitsubase bulkerlib bulkerapp sync-controller sync-sidecar

WORKDIR /app/sync-controller

RUN go mod download

WORKDIR /app

COPY . .

# Build bulker
RUN go build -o syncctl ./sync-controller

#######################################
# FINAL STAGE
FROM main as final

RUN mkdir /app
WORKDIR /app

COPY --from=build /app/syncctl ./
#COPY ./config.yaml ./

CMD ["/app/syncctl"]
