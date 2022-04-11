# BASE STAGE
FROM debian:bullseye-slim as main

# Install dependencies
RUN apt-get update
RUN DEBIAN_FRONTEND=noninteractive TZ=Etc/UTC apt-get -y install tzdata
RUN apt-get install -y --fix-missing bash python3 python3-pip python3-venv python3-dev sudo curl

#install docker
RUN apt-get install apt-transport-https ca-certificates curl gnupg lsb-release -y
RUN curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
RUN echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
RUN apt-get update
RUN apt-get install -y docker-ce docker-ce-cli containerd.io

ARG TARGETARCH
ARG dhid
ARG SDK_VERSION=latest
ENV DOCKER_HUB_ID=$dhid
ENV TZ=UTC
ENV EVENTNATIVE_USER=eventnative

RUN echo "$EVENTNATIVE_USER     ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
    && addgroup --system $EVENTNATIVE_USER \
    && adduser --system  $EVENTNATIVE_USER  \
    && adduser $EVENTNATIVE_USER $EVENTNATIVE_USER \
        && adduser $EVENTNATIVE_USER docker \
        && adduser $EVENTNATIVE_USER daemon \
        && adduser $EVENTNATIVE_USER root \
        && adduser $EVENTNATIVE_USER bin \
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

# Download SDK npm package
RUN mkdir /web && curl -o /web/lib.js https://unpkg.com/@jitsu/sdk-js@$SDK_VERSION/dist/web/lib.js

RUN mkdir /app

# Copy js
ADD server/web /go/src/github.com/jitsucom/jitsu/server/web
ADD server/Makefile /go/src/github.com/jitsucom/jitsu/server/Makefile

WORKDIR /go/src/github.com/jitsucom/jitsu/server
# Build js (for caching) and copy builded files
RUN make assemble_js &&\
    cp -r ./build/dist/* /app

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
COPY --from=main /app .
COPY --from=main /web/lib.js ./web/lib.js

COPY docker/eventnative.yaml /home/$EVENTNATIVE_USER/data/config/

RUN chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/$EVENTNATIVE_USER/app

ADD server/entrypoint.sh /home/$EVENTNATIVE_USER/entrypoint.sh
RUN chmod +x /home/$EVENTNATIVE_USER/entrypoint.sh

USER $EVENTNATIVE_USER

VOLUME ["/home/$EVENTNATIVE_USER/data"]
EXPOSE 8001

SHELL ["/bin/bash","-c"]

ENTRYPOINT /home/$EVENTNATIVE_USER/entrypoint.sh