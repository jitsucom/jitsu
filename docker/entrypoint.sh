#!/usr/bin/env bash

### Vars
PID_SERVER=0
PID_CONFIGURATOR=0

### Funcs
#generates and returns random sequence of letters and numbers
random(){
  cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 32 | head -n 1
}
#kills server and configurator with SIGTERM
graceful_exit() {
  echo "graceful_exit"
  kill -SIGTERM "$PID_SERVER" 2>/dev/null
  sleep 5
  kill -SIGTERM "$PID_CONFIGURATOR" 2>/dev/null
  exit 143; # 128 + 15 -- SIGTERM
}
#if at least one of services has exited - do shutdown
check_shutdown(){
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
    graceful_exit
  fi
  if [ $PROCESS_SERVER -ne 0 ]; then
    echo "Jitsu Server has already exited."
    graceful_exit
  fi
  if [ $PROCESS_NGINX -ne 0 ]; then
    echo "Nginx has already exited."
    graceful_exit
  fi
}

### Parameters
# Jitsu port
NGINX_PORT_VALUE=$PORT
if [[ -z "$NGINX_PORT_VALUE" ]]; then
  NGINX_PORT_VALUE=8000
fi

# Jitsu Server admin token
if [[ -z "$SERVER_ADMIN_TOKEN" ]]; then
  export SERVER_ADMIN_TOKEN=$(random)
fi

# Jitsu Configurator admin token
if [[ -z "$CONFIGURATOR_ADMIN_TOKEN" ]]; then
  export CONFIGURATOR_ADMIN_TOKEN=$(random)
fi

# Jitsu UI authorization access secret
if [[ -z "$UI_AUTH_ACCESS_SECRET" ]]; then
  export UI_AUTH_ACCESS_SECRET=$(random)
fi

# Jitsu UI authorization refresh secret
if [[ -z "$UI_AUTH_REFRESH_SECRET" ]]; then
  export UI_AUTH_REFRESH_SECRET=$(random)
fi

trap graceful_exit SIGQUIT SIGTERM SIGINT SIGHUP

### Start services
# Start Jitsu Configurator process
/home/configurator/app/configurator -cfg=/home/configurator/data/config/configurator.yaml -cr=true -dhid=jitsu &
PID_CONFIGURATOR=$!

sleep 2

# Start Jitsu Server process
/home/eventnative/app/eventnative -cfg=/home/eventnative/data/config/eventnative.yaml -cr=true -dhid=jitsu &
PID_SERVER=$!

sleep 1

# Start Nginx process
sed "s/NGINX_PORT/$NGINX_PORT_VALUE/g" /etc/nginx/nginx.conf > /etc/nginx/nginx_replaced.conf && \
mv /etc/nginx/nginx_replaced.conf /etc/nginx/nginx.conf && \
nginx -g 'daemon off;' &

sleep 1

check_shutdown

echo "=============================================================================="
echo "                           🌪 Jitsu has started!"
echo "             💻 visit http://localhost:$NGINX_PORT_VALUE/configurator"
echo "=============================================================================="

### Shutdown loop
# wait forever and check every 3 seconds shutdown
while sleep 3; do
  check_shutdown
done