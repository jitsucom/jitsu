ARG SRC_VERSION=latest

FROM nginx:alpine as main

RUN apk add --no-cache gcompat build-base python3 py3-pip python3-dev tzdata bash sudo docker curl npm nano

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
    && mkdir -p /home/$EVENTNATIVE_USER/app \
    && chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/$EVENTNATIVE_USER \
    && echo 'if [ -e /var/run/docker.sock ]; then sudo chmod 666 /var/run/docker.sock; fi' > /home/eventnative/.bashrc \
    && echo ''

# Create symlink for backward compatibility
RUN ln -s /home/$EVENTNATIVE_USER/data/config /home/$EVENTNATIVE_USER/app/res && \
    ln -s /home/$EVENTNATIVE_USER/data/logs /home/$EVENTNATIVE_USER/logs && \
    chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/$EVENTNATIVE_USER/logs
#######################################
FROM jitsucom/server:${SRC_VERSION} as server
#######################################
FROM jitsucom/configurator:${SRC_VERSION} as configurator
#######################################
# FINAL STAGE
FROM main as final

USER root

ENV TZ=UTC

COPY --from=configurator /home/configurator /home/configurator
COPY --from=server /home/eventnative /home/eventnative

ADD eventnative.yaml /home/eventnative/data/config/
ADD entrypoint.sh /home/eventnative/entrypoint.sh
ADD nginx.conf /etc/nginx/nginx.conf
RUN mv /home/configurator/app/web /home/configurator/web &&\
  touch /var/run/nginx.pid && \
  chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/configurator && \
  chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/eventnative && \
  chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /var/cache/nginx /var/run/nginx.pid /var/log/nginx /etc/nginx &&\
  chmod +x /home/eventnative/entrypoint.sh

USER $EVENTNATIVE_USER

VOLUME ["/home/$EVENTNATIVE_USER/data", "/home/configurator/data"]
EXPOSE 8000

ENTRYPOINT ["/home/eventnative/entrypoint.sh"]