#!/usr/bin/env bash

read -p "Enter jitsu verstion [latest]: " jitsu_version
read -p "Enter api token (stream, batch, transform, transform_batch) [transform]: " api_token
read -p "Enter requests count [1_000_000]: " requests
read -p "Enter requests concurrency [100]: " concurrency

JITSU_VERSION=${jitsu_version:-latest} docker-compose up &

echo "Warming up..."
sleep 20

docker run --rm --net=benchmark_main -p 18888:18888 -v $PWD/request.json:/tmp/request.json ghcr.io/six-ddc/plow -c ${concurrency:-100} -n ${requests:-1000000} --body @/tmp/request.json -T application/json -m POST http://jitsu:8000/api/v1/event?token=${api_token:-transform}

read -p "Press any key to shutdown jitsu: " confirm
docker-compose down

#      - "-c"
#      - "${CONCURRENCY:-100}"
#      - "-n"
#      - "${REQUESTS:-100000}"
#      - "--body"
#      - "@/tmp/request.json"
#      - "-T"
#      - "application/json"
#      - "-m"
#      - "POST"
#      - "http://jitsu:8000/api/v1/event?token=${API_KEY:-transform_api_key}"