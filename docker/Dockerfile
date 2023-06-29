ARG SRC_VERSION=latest

FROM nginx:latest as main

# Install dependencies
RUN apt-get update
RUN DEBIAN_FRONTEND=noninteractive TZ=Etc/UTC apt-get -y install tzdata
RUN apt-get install -y apt-transport-https
RUN apt-get install -y --fix-missing bash python3 python3-pip python3-venv python3-dev sudo curl dnsutils

#install docker
RUN apt-get install -y ca-certificates curl gnupg lsb-release
RUN curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
RUN echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
RUN apt-get update
RUN apt-get install -y docker-ce docker-ce-cli containerd.io

# Install node
RUN curl -o- -sL https://deb.nodesource.com/setup_16.x | bash
RUN hash -r
RUN npm install -g node-fetch@2.6.7 vm2@3.9.9

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
#######################################
FROM jitsucom/server:${SRC_VERSION} as server
#######################################
FROM jitsucom/configurator:${SRC_VERSION} as configurator
#######################################
# FINAL STAGE
FROM main as final

USER root

ENV TZ=UTC
ENV NODE_PATH=/usr/lib/node_modules

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