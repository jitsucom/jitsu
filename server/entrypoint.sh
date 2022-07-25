#!/usr/bin/env bash
PID_SERVER=0
echo "Starting Jitsu Server $@"

USER=$(stat -c '%U' /home/$EVENTNATIVE_USER)
if [ "$USER" != "$EVENTNATIVE_USER" ]; then
  sudo chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/$EVENTNATIVE_USER
fi

# Apply bashrc
source ~/.bashrc

#kills server with SIGTERM
graceful_exit() {
  echo "graceful_exit"
  kill -SIGTERM "$PID_SERVER" 2>/dev/null
  sleep 3
  exit 143; # 128 + 15 -- SIGTERM
}

trap graceful_exit SIGQUIT SIGTERM SIGINT SIGHUP

# run application
~/app/eventnative -cfg=/home/$EVENTNATIVE_USER/data/config/eventnative.yaml -cr=true -dhid="$DOCKER_HUB_ID" &
PID_SERVER=$!

# wait forever
while true
do
  tail -f /dev/null & wait ${!}
done

