# BASE STAGE
FROM debian:bullseye-slim as main

# Install dependencies
RUN apt-get update
RUN DEBIAN_FRONTEND=noninteractive TZ=Etc/UTC apt-get -y install tzdata
RUN apt-get install -y --fix-missing bash python3 python3-pip python3-venv python3-dev sudo curl

ARG TARGETARCH
ARG dhid
ENV DOCKER_HUB_ID=$dhid
ENV CONFIGURATOR_USER=configurator
ENV TZ=UTC

RUN addgroup --system $CONFIGURATOR_USER \
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

# add backend
ADD configurator/backend/build/dist/ /home/$CONFIGURATOR_USER/app/

# add frontend
ADD configurator/frontend/build/ /home/$CONFIGURATOR_USER/app/web/

RUN chown -R $CONFIGURATOR_USER:$CONFIGURATOR_USER /home/$CONFIGURATOR_USER/app

ADD configurator/backend/entrypoint.sh /home/$CONFIGURATOR_USER/entrypoint.sh
RUN chmod +x /home/$CONFIGURATOR_USER/entrypoint.sh

USER $CONFIGURATOR_USER
WORKDIR /home/$CONFIGURATOR_USER/app

COPY docker/configurator.yaml /home/$CONFIGURATOR_USER/data/config/

VOLUME ["/home/$CONFIGURATOR_USER/data"]
EXPOSE 7000

ENTRYPOINT ["/home/$CONFIGURATOR_USER/entrypoint.sh"]