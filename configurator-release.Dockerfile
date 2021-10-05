# BASE STAGE
FROM alpine:3.13 as main

ARG dhid
ENV DOCKER_HUB_ID=$dhid
ENV CONFIGURATOR_USER=configurator
ENV TZ=UTC

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
# BUILD BACKEND STAGE
FROM jitsucom/configurator-builder as builder

ENV CONFIGURATOR_USER=configurator

RUN mkdir -p /go/src/github.com/jitsucom/jitsu/$CONFIGURATOR_USER/backend && \
    mkdir -p /go/src/github.com/jitsucom/jitsu/server

WORKDIR /go/src/github.com/jitsucom/jitsu/$CONFIGURATOR_USER/backend

#Caching dependencies
ADD configurator/backend/go.mod ./
ADD server/go.mod /go/src/github.com/jitsucom/jitsu/server/
RUN go mod tidy && go mod download

#Copy backend
ADD configurator/backend/. ./.
ADD server /go/src/github.com/jitsucom/jitsu/server
ADD .git /go/src/github.com/jitsucom/jitsu/.git

# Build
RUN make docker_assemble
#######################################
# FINAL STAGE
FROM main as final

# add frontend
ADD configurator/frontend/build/ /home/$CONFIGURATOR_USER/app/web/

# add backend
COPY --from=builder /go/src/github.com/jitsucom/jitsu/$CONFIGURATOR_USER/backend/build/dist/configurator /home/$CONFIGURATOR_USER/app/configurator

RUN chown -R $CONFIGURATOR_USER:$CONFIGURATOR_USER /home/$CONFIGURATOR_USER/app

USER $CONFIGURATOR_USER
WORKDIR /home/$CONFIGURATOR_USER/app

VOLUME ["/home/$CONFIGURATOR_USER/data"]
EXPOSE 7000

ENTRYPOINT ./configurator -cfg=../data/config/configurator.yaml -cr=true -dhid="$DOCKER_HUB_ID"