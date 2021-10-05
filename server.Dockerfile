# BASE STAGE
FROM alpine:3.13 as main

RUN apk add --no-cache build-base python3 py3-pip python3-dev tzdata

ARG dhid
ENV DOCKER_HUB_ID=$dhid

ENV EVENTNATIVE_USER=eventnative

RUN addgroup -S $EVENTNATIVE_USER \
    && adduser -S -G $EVENTNATIVE_USER $EVENTNATIVE_USER \
    && mkdir -p /home/$EVENTNATIVE_USER/data/logs/events \
    && mkdir -p /home/$EVENTNATIVE_USER/data/config \
    && mkdir -p /home/$EVENTNATIVE_USER/data/venv \
    && mkdir -p /home/$EVENTNATIVE_USER/app \
    && chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/$EVENTNATIVE_USER

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
RUN make clean_js js assemble_js &&\
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
FROM jitsucom/server-builder as builder

RUN mkdir /app

WORKDIR /go/src/github.com/jitsucom/jitsu/server

#Caching dependencies
ADD server/go.mod ./
RUN go mod tidy && go mod download

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

RUN chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/$EVENTNATIVE_USER/app

USER $EVENTNATIVE_USER

VOLUME ["/home/$EVENTNATIVE_USER/data"]
EXPOSE 8001

ENTRYPOINT ./eventnative -cfg=../data/config/eventnative.yaml -cr=true -dhid="$DOCKER_HUB_ID"