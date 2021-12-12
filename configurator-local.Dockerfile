# BASE STAGE
FROM alpine:3.13

RUN apk add --no-cache build-base python3 py3-pip python3-dev tzdata bash sudo curl

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

# add backend
ADD configurator/backend/build/dist/ /home/$CONFIGURATOR_USER/app/

# add frontend
ADD configurator/frontend/build/ /home/$CONFIGURATOR_USER/app/web/

RUN chown -R $CONFIGURATOR_USER:$CONFIGURATOR_USER /home/$CONFIGURATOR_USER/app

USER $CONFIGURATOR_USER
WORKDIR /home/$CONFIGURATOR_USER/app

COPY docker/configurator.yaml /home/$CONFIGURATOR_USER/data/config/

VOLUME ["/home/$CONFIGURATOR_USER/data"]
EXPOSE 7000

ENTRYPOINT ./configurator -cfg=/home/$CONFIGURATOR_USER/data/config/configurator.yaml -cr=true -dhid="$DOCKER_HUB_ID"