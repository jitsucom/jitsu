# BASE STAGE
FROM alpine:3.12 as main

RUN apk add --no-cache build-base python3 py3-pip python3-dev tzdata

ARG dhid
ENV DOCKER_HUB_ID=$dhid

ENV EVENTNATIVE_USER=eventnative

RUN addgroup -S $EVENTNATIVE_USER \
    && adduser -S -G $EVENTNATIVE_USER $EVENTNATIVE_USER \
    && mkdir -p /home/$EVENTNATIVE_USER/logs/events \
    && mkdir -p /home/$EVENTNATIVE_USER/app/res \
    && chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/$EVENTNATIVE_USER

#######################################
# BUILD JS STAGE
FROM golang:1.14.6-alpine3.12 as jsbuilder

RUN mkdir /app

# Install dependencies
RUN apk add git make bash npm

# Copy js
ADD server/web /go/src/github.com/jitsucom/jitsu/server/web
ADD server/Makefile /go/src/github.com/jitsucom/jitsu/server/Makefile

WORKDIR /go/src/github.com/jitsucom/jitsu/server
# Build js (for caching) and copy builded files
RUN make clean_js assemble_js &&\
    cp -r ./build/dist/* /app

#######################################
# BUILD BACKEND STAGE
FROM golang:1.14.6-alpine3.12 as builder

RUN mkdir /app

# Install dependencies
RUN apk add git make bash build-base

#Copy backend
ADD server /go/src/github.com/jitsucom/jitsu/server
ADD .git /go/src/github.com/jitsucom/jitsu/.git

WORKDIR /go/src/github.com/jitsucom/jitsu/server
# Build backend and copy builded files
RUN make clean_backend assemble_backend &&\
    cp -r ./build/dist/* /app

#######################################
# FINAL STAGE
FROM main as final

ENV TZ=UTC

WORKDIR /home/$EVENTNATIVE_USER/app

# copy static files from build-image
COPY --from=builder /app .
COPY --from=jsbuilder /app .

RUN chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/$EVENTNATIVE_USER/app

USER $EVENTNATIVE_USER

VOLUME ["/home/$EVENTNATIVE_USER/app/res", "/home/$EVENTNATIVE_USER/logs", "/home/$EVENTNATIVE_USER/logs/events"]
EXPOSE 8001

ENTRYPOINT ./eventnative -cfg=./res/eventnative.yaml -cr=true -dhid=$DOCKER_HUB_ID