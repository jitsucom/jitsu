#!/bin/bash

# Start Jitsu Configurator process
nohup /home/configurator/app/configurator -cfg=/home/configurator/data/config/configurator.yaml -cr=true &
status=$?
if [ $status -ne 0 ]; then
  echo "Failed to start Jitsu Configurator: $status"
  exit $status
fi

sleep 1

# Start Jitsu Server process
nohup /home/eventnative/app/eventnative -cfg=/home/eventnative/data/config/eventnative.yaml -cr=true &
status=$?
if [ $status -ne 0 ]; then
  echo "Failed to start Jitsu Server : $status"
  exit $status
fi

sleep 1

# Start Nginx process
NGINX_PORT_VALUE=$PORT
sed "s/NGINX_PORT/$NGINX_PORT_VALUE/g" /etc/nginx/nginx.conf > /etc/nginx/nginx_replaced.conf && \
mv /etc/nginx/nginx_replaced.conf /etc/nginx/nginx.conf && \
nohup nginx -g 'daemon off;' &
status=$?
if [ $status -ne 0 ]; then
  echo "Failed to start Nginx : $status"
  exit $status
fi

sleep 1


# Naive check runs checks once a minute to see if either of the processes exited.
# This illustrates part of the heavy lifting you need to do if you want to run
# more than one service in a container. The container exits with an error
# if it detects that either of the processes has exited.
# Otherwise it loops forever, waking up every 60 seconds

while sleep 5; do
  ps aux |grep configurator |grep -q -v grep
  PROCESS_CONFIGURATOR=$?
  ps aux |grep eventnative |grep -q -v grep
  PROCESS_SERVER=$?
  ps aux |grep nginx |grep -q -v grep
  PROCESS_NGINX=$?
  # If the greps above find anything, they exit with 0 status
  # If they are not both 0, then something is wrong
  if [ $PROCESS_CONFIGURATOR -ne 0 ]; then
    echo "Jitsu Configurator has already exited."
    exit 1
  fi
  if [ $PROCESS_SERVER -ne 0 ]; then
    echo "Jitsu Server has already exited."
    exit 1
  fi
  if [ $PROCESS_NGINX -ne 0 ]; then
    echo "Nginx has already exited."
    exit 1
  fi
done