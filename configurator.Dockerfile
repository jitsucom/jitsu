# BASE STAGE
FROM alpine:3.12 as main

ENV CONFIGURATOR_USER=configurator

RUN addgroup -S $CONFIGURATOR_USER \
    && adduser -S -G $CONFIGURATOR_USER $CONFIGURATOR_USER \
    && mkdir -p /home/$CONFIGURATOR_USER/data/logs \
    && mkdir -p /home/$CONFIGURATOR_USER/data/config \
    && mkdir -p /home/$CONFIGURATOR_USER/app/web \
    && chown -R $CONFIGURATOR_USER:$CONFIGURATOR_USER /home/$CONFIGURATOR_USER

# Create symlink for backward compatibility
RUN ln -s /home/$CONFIGURATOR_USER/data/config /home/$CONFIGURATOR_USER/app/res && \
    ln -s /home/$CONFIGURATOR_USER/data/logs /home/$CONFIGURATOR_USER/logs && \
    chown -R $CONFIGURATOR_USER:$CONFIGURATOR_USER /home/$CONFIGURATOR_USER/logs

#######################################
# BUILD BASE STAGE
FROM golang:1.14.6-alpine3.12 as builder

# Install dependencies
RUN apk add git make bash npm yarn

#######################################
# BUILD JS STAGE
FROM builder as jsbuilder

ARG SKIP_UI_BUILD
ENV SKIP_UI $SKIP_UI_BUILD

# Install yarn dependencies
ADD configurator/frontend/package.json /app/package.json

WORKDIR /app

# We need to make sure empty 'build' directory exists if SKIP_UI_BUILD==true and yarn won't make it
RUN mkdir build

RUN if [ $SKIP_UI != true ]; then yarn install --network-timeout 1000000; fi

# Copy project
ADD configurator/frontend/. ./

# Build
RUN if [ $SKIP_UI != true ]; then yarn build --network-timeout 1000000; fi

#######################################
# BUILD BACKEND STAGE
FROM builder as builder

ENV CONFIGURATOR_USER=configurator

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

VOLUME ["/home/$CONFIGURATOR_USER/data"]
EXPOSE 7000

ENTRYPOINT ["./configurator", "-cfg=../data/config/configurator.yaml", "-cr=true"]
