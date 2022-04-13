## Benchmark

Package for running benchmark tests with:
- Postgres
- Redis
- Jitsu
- [Benchmark tool](https://github.com/six-ddc/plow)


### Get started

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