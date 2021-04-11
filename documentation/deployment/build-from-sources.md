---
sort: 3
---

import {Hint} from "../../../components/documentationComponents";

# Build from sources

### Prerequisites

**EventNative** is written primarily in Go with the frontend written in JavaScript. 

To install the required pre-requisites see the following guides:

* [Installing Go \(&gt;=1.14.1\)](https://golang.org/doc/install)
* [Installing npm](https://www.npmjs.com/get-npm)

<Hint>
    Please make sure your version of Go is > 1.14.1 with the following command:
    <code inline="true">go version</code>.
</Hint>



### Cloning source code

**EventNative** code should be placed inside `$GOPATH` (see the following ["Effective Go"](https://golang.org/doc/gopath_code.html) chapter). Assuming that you didn't change the default value of GOPATH which is `~/go/` please use following commands:

```bash
cd ~/go/
mkdir -p src/github.com/jitsucom/eventnative
cd src/github.com/jitsucom/eventnative
git clone https://github.com/jitsucom/eventnative.git .
```

Building **EventNative** is simple, just run:

```bash
make all
```

<Hint>If you don't have <code inline={true}>make</code> installed run <code inline={true}>sudo apt-get install make</code></Hint>

If build is successful, all artifacts will be placed inside the `./build/dist` directory:

```bash
$ ls -l ./build/dist
-rwxr-xr-x  1 vklmn  staff  30723620 Aug  6 15:58 eventnative
drwxr-xr-x  5 vklmn  staff       160 Aug  6 15:58 web
```

### Run EventNative

`./eventnative` is the main application binary; `web` contains static files \(JS and HTML\). Run the application with the following:

```bash
./eventnative
```

To pass in a configuration file (learn more at [Configuration](/docs/configuration) section), use `-cfg` parameter:

```bash
./eventnative -cfg /path/to/eventnative.yml
```

The configuration might be one of the [described formats](/docs/deployment/configuration-source). For example, run with [Raw JSON configuration source](/docs/deployment/configuration-source#raw-json):

```json
./eventnative -cfg '{"server":{"name":"test_instance", "auth":"token1"}}'
```

