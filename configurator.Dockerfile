# BASE STAGE
FROM alpine:3.12 as main

ENV CONFIGURATOR_USER=configurator

RUN addgroup -S $CONFIGURATOR_USER \
    && adduser -S -G $CONFIGURATOR_USER $CONFIGURATOR_USER \
    && mkdir -p /home/$CONFIGURATOR_USER/logs \
    && mkdir -p /home/$CONFIGURATOR_USER/app/res \
    && mkdir -p /home/$CONFIGURATOR_USER/app/web \
    && chown -R $CONFIGURATOR_USER:$CONFIGURATOR_USER /home/$CONFIGURATOR_USER

#######################################
# BUILD JS STAGE
FROM golang:1.14.6-alpine3.12 as jsbuilder

# Install dependencies
RUN apk add git make npm yarn

# Install yarn dependencies
ADD configurator/frontend/package.json /app/package.json

WORKDIR /app

RUN yarn install

# Copy project
ADD configurator/frontend/. ./

# Build
RUN yarn build

#######################################
# BUILD BACKEND STAGE
FROM golang:1.14.6-alpine3.12 as builder

ENV CONFIGURATOR_USER=configurator

# Install dependencies
RUN apk add git make bash

#Copy backend
ADD configurator/backend /go/src/github.com/jitsucom/jitsu/$CONFIGURATOR_USER/backend
ADD server /go/src/github.com/jitsucom/jitsu/server
ADD .git /go/src/github.com/jitsucom/jitsu/.git

WORKDIR /go/src/github.com/jitsucom/jitsu/$CONFIGURATOR_USER/backend

# Build
RUN make

#######################################
# FINAL STAGE
FROM main as final

ENV TZ=UTC

# copy static files from build-image
COPY --from=builder /go/src/github.com/jitsucom/jitsu/$CONFIGURATOR_USER/backend/build/dist /home/$CONFIGURATOR_USER/app
COPY --from=jsbuilder /app/build /home/$CONFIGURATOR_USER/app/web

RUN chown -R $CONFIGURATOR_USER:$CONFIGURATOR_USER /home/$CONFIGURATOR_USER/app

USER $CONFIGURATOR_USER
WORKDIR /home/$CONFIGURATOR_USER/app

VOLUME ["/home/$CONFIGURATOR_USER/logs", "/home/$CONFIGURATOR_USER/app/res"]
EXPOSE 7000

ENTRYPOINT ["./configurator", "-cfg=./res/configurator.yaml", "-cr=true"]