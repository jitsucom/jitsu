## Benchmark

Package for running benchmark tests with:
- Postgres
- Redis
- Jitsu
- [Benchmark tool](https://github.com/six-ddc/plow)

### Simple way

Run
```shell
benchmark.sh
```
And choose:
- what jitsu version you what to use
- api token
- mode: bulk or event
- events count to send
- request concurrency

By default benchmark uses config `./compose-data/server/data/config/eventnative.yaml`
but you may provide your config using `CONFIG_FILE` env variable.

### Bulk mode

Bulk mode uses `/api/v1/events/bulk` endpoint
Jitsu process bulk endpoint synchronously. So this is the only way to measure full processing speed.

Workload produced with `bulk.payload` file that contains multipart form data with .ndjson file containing multiple json events.
You can customize payload file using `BULK_PAYLOAD` env variable.

Keep in mind that produced RPS metrics must be multiplied by events count in bulk to translate to events per second. 

### Event mode

Event mode uses `/api/v1/event` endpoint.
Jitsu process such event asynchronously. So benchmark in this mode really measure HTTP request processing and working with queues or file logs.

Workload produced with `request.json` file that contains single json event.
You can customize payload file using `EVENT_PAYLOAD` env variable.

### Manual way

1. Run Docker compose

```shell
docker-compose up
```

2. Test stream destination

```shell
docker run --rm --net=benchmark_main -p 18888:18888 -v $PWD/request.json:/tmp/request.json ghcr.io/six-ddc/plow -c 500 -d 1m --body @/tmp/request.json -T 'application/json' -m POST 'http://jitsu:8000/api/v1/event?token=stream'
```

3. Test batch destination

```shell
docker run --rm --net=benchmark_main -p 18888:18888 -v $PWD/request.json:/tmp/request.json ghcr.io/six-ddc/plow -c 500 -d 1m --body @/tmp/request.json -T 'application/json' -m POST 'http://jitsu:8000/api/v1/event?token=batch'
```

You can change flag parameters e.g. `-c 500` -concurrency level or `-d 1m` - duration 1 minute. 