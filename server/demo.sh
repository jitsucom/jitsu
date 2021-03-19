#!/usr/bin/env bash

function start() {
  echo "Your data directory: [Enter for default '/tmp/eventnative']"
  read dir
  if [[ $dir == "" ]]; then
    dir="/tmp/eventnative"
  fi

  echo "Creating directories.."
  mkdir -p $dir/redis_data
  mkdir -p $dir/res
  mkdir -p $dir/logs
  mkdir -p $dir/events
  chmod -R 777 $dir

  cp demo/eventnative.yaml $dir/res

  echo "Running EventNative.."
  DATA_DIR=$dir docker-compose up && docker-compose rm
}

echo "** Demo EventNative **"
echo ""
read -r -p "Have you changed demo/eventnative.yaml and added your configuration? [y/n] " ready

case $ready in
    [yY][eE][sS]|[yY])
        start
        ;;
    [nN][oO]|[nN])
        echo "Please change demo/eventnative.yaml and add your configuration first!"
        exit 0
        ;;
    *)
        echo "Invalid input..."
        exit 1
        ;;
esac