# BASE STAGE
FROM alpine:3.15.4 as main

RUN apk add --no-cache build-base python3 py3-pip python3-dev tzdata docker bash sudo curl npm

ARG TARGETARCH
ARG dhid
ENV DOCKER_HUB_ID=$dhid
ENV TZ=UTC
ENV EVENTNATIVE_USER=eventnative

RUN sed -e 's;^# \(%wheel.*NOPASSWD.*\);\1;g' -i /etc/sudoers \
    && addgroup -S $EVENTNATIVE_USER \
    && adduser -S -G $EVENTNATIVE_USER $EVENTNATIVE_USER \
    && addgroup -S $EVENTNATIVE_USER docker \
        && addgroup -S $EVENTNATIVE_USER daemon \
        && addgroup -S $EVENTNATIVE_USER root \
        && addgroup -S $EVENTNATIVE_USER bin \
    && addgroup -S $EVENTNATIVE_USER wheel \
    && mkdir -p /home/$EVENTNATIVE_USER/data/logs/events \
    && mkdir -p /home/$EVENTNATIVE_USER/data/config \
    && mkdir -p /home/$EVENTNATIVE_USER/data/venv \
    && mkdir -p /home/$EVENTNATIVE_USER/data/airbyte \
    && mkdir -p /home/$EVENTNATIVE_USER/app/ \
    && chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/$EVENTNATIVE_USER \
    && echo "if [ -e /var/run/docker.sock ]; then sudo chmod 666 /var/run/docker.sock; fi" > /home/eventnative/.bashrc

# Create symlink for backward compatibility
RUN ln -s /home/$EVENTNATIVE_USER/data/config /home/$EVENTNATIVE_USER/app/res && \
    ln -s /home/$EVENTNATIVE_USER/data/logs /home/$EVENTNATIVE_USER/logs && \
    chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/$EVENTNATIVE_USER/logs

#######################################
# BUILD JS STAGE
FROM jitsucom/server-builder as jsbuilder

RUN mkdir /app

# Copy js
ADD server/web /go/src/github.com/jitsucom/jitsu/server/web
ADD server/Makefile /go/src/github.com/jitsucom/jitsu/server/Makefile

WORKDIR /go/src/github.com/jitsucom/jitsu/server
# Build js (for caching) and copy builded files
RUN make assemble_js &&\
    cp -r ./build/dist/* /app

#######################################
# BUILD JS SDK STAGE
FROM jitsucom/server-builder as jsSdkbuilder

RUN mkdir /app

WORKDIR /javascript-sdk

# Install npm dependencies
ADD javascript-sdk/package.json javascript-sdk/yarn.lock ./
RUN yarn install --prefer-offline --frozen-lockfile --network-timeout 1000000

# Copy project
ADD javascript-sdk/. .

# Build
RUN yarn build && \
    test -e ./dist/web/lib.js && \
    cp ./dist/web/lib.js /app/

#######################################
# BUILD BACKEND STAGE
FROM jitsucom/jitsu-builder:$TARGETARCH as builder

RUN mkdir /app

WORKDIR /go/src/github.com/jitsucom/jitsu/server

#Caching dependencies
ADD server/go.mod ./
RUN go mod download

#Copy backend
ADD server/. ./.
ADD .git ./.git

# Build backend and copy builded files
RUN make docker_assemble &&\
    cp -r ./build/dist/* /app

#######################################
# FINAL STAGE
FROM main as final

ENV TZ=UTC

WORKDIR /home/$EVENTNATIVE_USER/app

# copy static files from build-image
COPY --from=builder /app .
COPY --from=jsbuilder /app .
COPY --from=jsSdkbuilder /app/lib.js ./web/lib.js

COPY docker/eventnative.yaml /home/$EVENTNATIVE_USER/data/config/

RUN chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/$EVENTNATIVE_USER/app

ADD server/entrypoint.sh /home/$EVENTNATIVE_USER/entrypoint.sh
RUN chmod +x /home/$EVENTNATIVE_USER/entrypoint.sh

USER $EVENTNATIVE_USER

VOLUME ["/home/$EVENTNATIVE_USER/data"]
EXPOSE 8001

SHELL ["/bin/bash","-c"]

ENTRYPOINT /home/$EVENTNATIVE_USER/entrypoint.sh