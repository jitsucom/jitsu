#!/usr/bin/env bash
echo "Starting Jitsu Server $@"

sudo chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/$EVENTNATIVE_USER

# Apply bashrc
source ~/.bashrc

~/app/eventnative -cfg=/home/$EVENTNATIVE_USER/data/config/eventnative.yaml -cr=true -dhid="$DOCKER_HUB_ID"