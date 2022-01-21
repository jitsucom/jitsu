#!/usr/bin/env bash
echo "Starting Jitsu Server $@"

sudo chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/$EVENTNATIVE_USER

# Apply bashrc
source ~/.bashrc

~/app/eventnative -cfg=~/data/config/eventnative.yaml -cr=true -dhid="$DOCKER_HUB_ID"