#!/usr/bin/env bash
echo "Starting Jitsu Configurator $@"

sudo chown -R $CONFIGURATOR_USER:$CONFIGURATOR_USER /home/$CONFIGURATOR_USER

~/app/configurator -cfg=/home/$CONFIGURATOR_USER/data/config/configurator.yaml -cr=true -dhid="$DOCKER_HUB_ID"