# BASE STAGE
FROM debian:bullseye-slim as main

# Install dependencies
RUN apt-get update
RUN DEBIAN_FRONTEND=noninteractive TZ=Etc/UTC apt-get -y install tzdata
RUN apt-get install -y --fix-missing bash python3 python3-pip python3-venv python3-dev sudo curl dnsutils

ARG TARGETARCH
ARG dhid
ENV DOCKER_HUB_ID=$dhid
ENV CONFIGURATOR_USER=configurator
ENV TZ=UTC

RUN echo "$CONFIGURATOR_USER     ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
    && addgroup --system $CONFIGURATOR_USER \
    && adduser --system $CONFIGURATOR_USER \
    && adduser $CONFIGURATOR_USER $CONFIGURATOR_USER \
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
FROM jitsucom/jitsu-builder:$TARGETARCH as builder

ENV CONFIGURATOR_USER=configurator

RUN mkdir -p /go/src/github.com/jitsucom/jitsu/$CONFIGURATOR_USER/backend && \
    mkdir -p /go/src/github.com/jitsucom/jitsu/server

WORKDIR /go/src/github.com/jitsucom/jitsu/$CONFIGURATOR_USER/backend

#Caching dependencies
ADD configurator/backend/go.mod ./
ADD server/go.mod /go/src/github.com/jitsucom/jitsu/server/
RUN go mod download

#Copy backend
ADD openapi /go/src/github.com/jitsucom/jitsu/openapi
ADD configurator/backend/. ./.
ADD server /go/src/github.com/jitsucom/jitsu/server
ADD .git /go/src/github.com/jitsucom/jitsu/.git

# Build
RUN make docker_assemble

#######################################
# FINAL STAGE
FROM main as final

# add frontend
ADD configurator/frontend/main/build/ /home/$CONFIGURATOR_USER/app/web/

# add backend
COPY --from=builder /go/src/github.com/jitsucom/jitsu/$CONFIGURATOR_USER/backend/build/dist/configurator /home/$CONFIGURATOR_USER/app/configurator

RUN chown -R $CONFIGURATOR_USER:$CONFIGURATOR_USER /home/$CONFIGURATOR_USER/app

ADD configurator/backend/entrypoint.sh /home/$CONFIGURATOR_USER/entrypoint.sh
RUN chmod +x /home/$CONFIGURATOR_USER/entrypoint.sh

USER $CONFIGURATOR_USER
WORKDIR /home/$CONFIGURATOR_USER/app

COPY docker/configurator.yaml /home/$CONFIGURATOR_USER/data/config/

VOLUME ["/home/$CONFIGURATOR_USER/data"]
EXPOSE 7000

ENTRYPOINT /home/$CONFIGURATOR_USER/entrypoint.sh