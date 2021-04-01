---
sort: 2
---

import {Hint} from "../../../components/documentationComponents";

# Deploying with Docker

**EventNative** provides a Docker image to simplify deployment on your IaaS or hardware of choice. We build two images:

* `ksense/eventnative:latest` — contains the latest stable production release. This image is built from [master](https://github.com/jitsucom/eventnative/tree/master) branch
* `ksense/eventnative:beta` — contains a latest beta version built from [beta](https://github.com/jitsucom/eventnative/tree/beta) branch

We recommend using beta for experiments. It's stable and well tested. It usually takes 2-4 months for the feature to graduate from beta to stable. This guide uses beta build. Just replace is with latest if you want to run a stable version

### Getting started with Docker

* Pull the image from Docker Hub with: `docker pull ksense/eventnative:beta`
* Create [your config file](/docs/configuration/) and save it in your directory of choice \(referenced below as `<config_dir>`\) as `eventnative.yaml`
* Create an empty directory for log files \(referenced below as `<log_dir>`\). EventNative will use this dir to keep temporary log-files. This parameter is optional, but if it's absent, data-consistency is not guaranteed - EventNative may lose data when the docker container is restarted

<Hint>
    Make sure &lt;config_dir&gt; and &lt;log_dir&gt; directories have right permissions or just run <code inline="true">chmod 777 &lt;your_dir&gt;</code>
</Hint>

* Run the Docker image and mount your config file with the following command:

```javascript
docker run -p <local_port>:8001 \
  -v /<config_dir>/:/home/eventnative/app/res/ \
  -v /<log_dir>/:/home/eventnative/logs/events/ \
  ksense/eventnative:beta
```

Please, refer `<log_dir>` and `<config_dir>` by their absolute paths. Use `$PWD` macro if necessary. Example:

```javascript
docker run --name eventnative-test -p 8000:8001 \n 
    -v $PWD/eventnative.yaml:/home/eventnative/app/res/eventnative.yaml \
    -v $PWD/eventnative-logs:/home/eventnative/logs/events/ \
    ksense/eventnative:beta
```

Also, **EventNative** supports passing config via `CONFIG_LOCATION` environment variable. The configuration might be one of the [described formats](/docs/deployment/configuration-source). For example, docker run with externalized [HTTP configuration source](/docs/deployment/configuration-source#http-source):

```javascript
docker run --name eventnative-test -p 8000:8001 \n 
    -v $PWD/eventnative-logs:/home/eventnative/logs/events/ \
    -e CONFIG_LOCATION='https://username:password@config-server.com?env=dev' \
    ksense/eventnative:beta
```

  
Once you see Started banner in logs, it **EventNative** is running.

