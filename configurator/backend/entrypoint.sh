#!/usr/bin/env bash
echo "Starting Jitsu Configurator $@"

USER=$(stat -c '%U' /home/$CONFIGURATOR_USER)
if [ "$USER" != "$CONFIGURATOR_USER" ]; then
  sudo chown -R $CONFIGURATOR_USER:$CONFIGURATOR_USER /home/$CONFIGURATOR_USER
fi

~/app/configurator -cfg=/home/$CONFIGURATOR_USER/data/config/configurator.yaml -cr=true -dhid="$DOCKER_HUB_ID"