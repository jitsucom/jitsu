# Jitsu configurator debug recipes

Those recipes help to spin-off a dev environment and debug configurator ui. 

## How to debug configurator UI locally

Just run this command in the **[root](https://github.com/jitsucom/jitsu)** directory of the project:

```bash
docker-compose -f docker-compose.dev-ui.yml up 
```

Usage:
 - Backend runs on [localhost:9875](http://localhost:9875). Check [http://localhost:9875/api/v1/system/configuration] to make sure it's working
 - [Run frontend](frontend/README.md) with BACKEND_API_BASE=`http://localhost:9875`. Use [http://localhost:9876/] to run frontend
 - Open [localhost:9874](http://localhost:9874) to see what's inside Redis. Use `redis` as host, `6379` as port. You need to do it once, the data
will be persisted accross runs
   

### Troubleshooting
 - `docker rm jitsu_configurator ; docker rmi jitsu_configurator` to clean all caches and make sure docker builds configurator from latest sources
 - `rm -rf ./ui-dev-compose/configurator/redis/data` if redis is not starting
