#!/bin/bash

cancel_healthcheck="0"
inited="0"
export my_pid=$$

init() {
  if [ "$inited" = "0" ]; then
    inited="1"
    curl --silent --output nul --show-error -H "Authorization: Bearer service-admin-account:$CONSOLE_RAW_AUTH_TOKENS" http://$(hostname -f):3000/api/admin/events-log-init
  fi
}

wait_for_service() {
    url=$1
    interval=$2
    max_wait=$3

    start_time=$(date +%s)
    end_time=$((start_time + max_wait))

    while true; do
        nc -z $(echo $url | tr ':' ' ') >/dev/null 2>&1

        if [ $? -eq 0 ]; then
            break
        fi

        current_time=$(date +%s)

        if [ $current_time -ge $end_time ]; then
            cancel_healthcheck="1"
            exit 1
        fi
        sleep $interval
    done
    init
    exit 0
}

healthcheck() {
  pid=$1
  echo "Waiting for $(hostname -f):3000 to be up..."
  service_down=$(wait_for_service $(hostname -f):3000 1 10)
  if [ "$service_down" = "1" ]; then
        echo "❌ ❌ ❌ HEALTHCHECK FAILED - $healthcheck_url is not UP"
        kill -9 $pid
  fi

  if [ "$cancel_healthcheck" = "0" ]; then
    echo "Running healthcheck..."
    healthcheck_url="http://$(hostname -f):3000/api/healthcheck"
    http_code=$(curl -s $healthcheck_url -o healthcheck-result -w '%{http_code}')
    if [ "$http_code" = "200" ]; then
        echo "⚡️⚡️⚡️ HEALTHCHECK PASSED - $http_code from $healthcheck_url. Details:"
        if [ -f healthcheck-result ]; then
            cat healthcheck-result
        fi
        echo ""
    else
        if [ "$http_code" = "000" ]; then
            echo "❌ ❌ ❌ HEALTHCHECK FAILED $healthcheck_url is not available"
        else
            echo "❌ ❌ ❌ HEALTHCHECK FAILED - $http_code from $healthcheck_url. Response:"
            if [ -f healthcheck-result ]; then
                cat healthcheck-result
            fi
            echo ""
        fi
        kill_console
        kill -9 $$
        exit 1
    fi
  fi
}

start_console() {
  cd /app/webapps/console
  HOSTNAME=0.0.0.0 node server.js & echo $! > /app/console.pid
  return $?
}

kill_console() {
  if [ -f /app/console.pid ]; then
    pid=$(cat /app/console.pid)
    echo "Killing console with pid $pid"
    kill -9 $pid
    #rm /app/console.pid
  fi
}

main() {
  cmd=$1
  export SIGNALS_LYFECICLE=1
  if [ -z "$cmd" ]; then
    if [ "$UPDATE_DB" = "1" ] || [ "$UPDATE_DB" = "yes" ] || [ "$UPDATE_DB" = "true" ]; then
      echo "UPDATE_DB is set, updating database schema..."
      prisma db push --skip-generate --schema schema.prisma
    fi
    echo "Starting the app"
    healthcheck $$ &
    exit_code=$(start_console)
    sleep 1000
    cancel_healthcheck="1"
    echo "App stopped with exit code ${exit_code}, exiting..."


  elif [ "$cmd" = "db-prepare" ]; then
    prisma db push --skip-generate --schema schema.prisma
  else
    echo "ERROR! Unknown command '$cmd'"
  fi
}

main "$@"
