# BASE STAGE
FROM alpine:3.13

RUN apk add --no-cache build-base python3 py3-pip python3-dev tzdata docker bash sudo curl npm

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

ADD server/build/dist/ /home/$EVENTNATIVE_USER/app/

WORKDIR /home/$EVENTNATIVE_USER/app

COPY docker/eventnative.yaml /home/$EVENTNATIVE_USER/data/config/

RUN chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/$EVENTNATIVE_USER/app

USER $EVENTNATIVE_USER

VOLUME ["/home/$EVENTNATIVE_USER/data"]
EXPOSE 8001

ENTRYPOINT source ~/.bashrc && ./eventnative -cfg=../data/config/eventnative.yaml -cr=true -dhid="$DOCKER_HUB_ID"