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
FROM jitsucom/server as server
#######################################
FROM jitsucom/configurator as configurator
#######################################
# FINAL STAGE
FROM main as final

USER root

ENV TZ=UTC

COPY --from=configurator /home/configurator /home/configurator
COPY --from=server /home/eventnative /home/eventnative
ADD configurator.yaml /home/configurator/data/config/
ADD eventnative.yaml /home/eventnative/data/config/
ADD heroku.sh /home/eventnative/heroku.sh

RUN chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/configurator
RUN chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/eventnative

USER $EVENTNATIVE_USER

VOLUME ["/home/$EVENTNATIVE_USER/data", "/home/configurator/data"]
EXPOSE 8001 7000

CMD sh /home/eventnative/heroku.sh