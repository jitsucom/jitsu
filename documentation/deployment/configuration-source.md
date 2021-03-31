---
sort: 4
---

import {Hint} from "../../../components/documentationComponents";

# Configuration Source


Regardless of the deployment method, **EventNative** supports local YAML or JSON file, HTTP source, and raw JSON as configuration sources. The configuration might be passed via `-cfg` flag (e.g. to [running service command from an executable binary](/docs/deployment/build-from-sources#run-eventnative)) or via `CONFIG_LOCATION` environment variable.

### Local File

Pass local file path with [configuration](/docs/configuration) to **EventNative**:

```bash
./eventnative -cfg /home/user/eventnative.yaml

#or

./eventnative -cfg file:///home/user/eventnative.yaml
```

### HTTP source

Pass external configuration to **EventNative** with or without basic auth:

```bash
./eventnative -cfg 'https://username:password@config-server.com?env=prod'

#or in docker deployments

docker run -p <local_port>:8001 \
  -v /<log_dir>/:/home/eventnative/logs/events/ \
  -e CONFIG_LOCATION='https://username:password@config-server.com?env=prod' \
  ksense/eventnative:beta
```

<Hint>
    HTTP source must return JSON or YAML payload with <code inline="true">application/json</code> or <code inline="true">application/yaml</code> response header respectively.
</Hint>

### Raw JSON

Pass raw JSON payload to **EventNative**:

```json
./eventnative -cfg '{"server":{"name":"test_instance", "auth":"token1"}}'

#or in docker deployments

docker run -p <local_port>:8001 \
  -v /<log_dir>/:/home/eventnative/logs/events/ \
  -e CONFIG_LOCATION='{"server":{"name":"test_instance", "auth":"token1"}}' \
  ksense/eventnative:beta
```

