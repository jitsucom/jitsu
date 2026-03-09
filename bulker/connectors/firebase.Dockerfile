FROM debian:bullseye-slim as main

RUN apt-get update -y
RUN apt-get install -y ca-certificates curl

ENV TZ=UTC

FROM golang:1.25-bullseye as build

RUN apt-get install gcc libc6-dev


RUN mkdir /app
WORKDIR /app

RUN mkdir firebase airbytecdk


COPY airbytecdk/go.* ./airbytecdk/
COPY firebase/go.* ./firebase/

RUN go work init airbytecdk firebase

WORKDIR /app/firebase

RUN go mod download

WORKDIR /app

COPY . .

# Build bulker
RUN go build -o firebase ./firebase

#######################################
# FINAL STAGE
FROM main as final

RUN mkdir /app
WORKDIR /app

COPY --from=build /app/firebase ./
#COPY ./config.yaml ./

ENV AIRBYTE_ENTRYPOINT "/app/firebase"
ENTRYPOINT ["/app/firebase"]
