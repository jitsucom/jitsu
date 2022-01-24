### JS/GO BUILDER
FROM debian:bullseye-slim

RUN echo "deb http://deb.debian.org/debian bullseye-backports main contrib non-free" > /etc/apt/sources.list.d/backports.list
# Install dependencies
RUN apt-get update
RUN DEBIAN_FRONTEND=noninteractive TZ=Etc/UTC apt-get -y install tzdata
RUN apt-get install -y golang-1.17-go/bullseye-backports git make bash

# GO
ENV PATH="/usr/lib/go-1.17/bin:${PATH}"
RUN mkdir -p /go/src/github.com/deps/install

WORKDIR /go/src/github.com/deps/install

RUN echo '\n\
           module github.com/deps/install \n\
           \n\
           go 1.17 \n\
           \n\
           require ( \n\
           cloud.google.com/go/bigquery v1.8.0 \n\
           cloud.google.com/go/firestore v1.1.1 \n\
           cloud.google.com/go/storage v1.10.0 \n\
           firebase.google.com/go/v4 v4.1.0 \n\
           github.com/FZambia/sentinel v1.1.0 \n\
           github.com/aws/aws-sdk-go v1.34.0 \n\
           github.com/charmbracelet/lipgloss v0.2.1 \n\
           github.com/docker/docker v20.10.11+incompatible \n\
           github.com/docker/go-connections v0.4.0 \n\
           github.com/dop251/goja v0.0.0-20211022113120-dc8c55024d06 \n\
           github.com/gin-gonic/gin v1.7.3 \n\
           github.com/go-redsync/redsync/v4 v4.3.0 \n\
           github.com/go-sql-driver/mysql v1.6.0 \n\
           github.com/gomodule/redigo v1.8.2 \n\
           github.com/google/go-cmp v0.5.6 \n\
           github.com/google/go-github/v32 v32.1.0 \n\
           github.com/google/martian v2.1.0+incompatible \n\
           github.com/google/uuid v1.3.0 \n\
           github.com/gookit/color v1.3.1 \n\
           github.com/hashicorp/go-multierror v1.1.0 \n\
           github.com/huandu/facebook/v2 v2.5.3 \n\
           github.com/iancoleman/strcase v0.2.0 \n\
           github.com/jitsucom/goque/v2 v2.2.0 \n\
           github.com/joncrlsn/dque v0.0.0-20200702023911-3e80e3146ce5 \n\
           github.com/lib/pq v1.10.2 \n\
           github.com/logrusorgru/aurora v2.0.3+incompatible \n\
           github.com/mailru/go-clickhouse v1.3.0 \n\
           github.com/mitchellh/hashstructure/v2 v2.0.1 \n\
           github.com/mitchellh/mapstructure v1.4.1 \n\
           github.com/olekukonko/tablewriter v0.0.4 \n\
           github.com/oschwald/geoip2-golang v1.4.0 \n\
           github.com/panjf2000/ants/v2 v2.4.6 \n\
           github.com/prometheus/client_golang v1.7.1 \n\
           github.com/robfig/cron/v3 v3.0.1 \n\
           github.com/satori/go.uuid v1.2.0 \n\
           github.com/shirou/gopsutil/v3 v3.21.9 \n\
           github.com/snowflakedb/gosnowflake v1.3.8 \n\
           github.com/spf13/cast v1.3.1 \n\
           github.com/spf13/cobra v1.2.1 \n\
           github.com/spf13/viper v1.8.1 \n\
           github.com/stretchr/testify v1.7.0 \n\
           github.com/testcontainers/testcontainers-go v0.12.0 \n\
           github.com/ua-parser/uap-go v0.0.0-20200325213135-e1c09f13e2fe \n\
           github.com/vbauerster/mpb/v7 v7.1.3 \n\
           github.com/xitongsys/parquet-go v1.6.1 \n\
           github.com/xitongsys/parquet-go-source v0.0.0-20211010230925-397910c5e371 \n\
           go.etcd.io/etcd/client/v3 v3.5.0-alpha.0 \n\
           go.uber.org/atomic v1.7.0 \n\
           golang.org/x/net v0.0.0-20211108170745-6635138e15ea \n\
           golang.org/x/oauth2 v0.0.0-20210819190943-2bc19b11175f \n\
           golang.org/x/term v0.0.0-20201126162022-7de9c90e9dd1 \n\
           google.golang.org/api v0.56.0 \n\
           google.golang.org/genproto v0.0.0-20210828152312-66f60bf46e71 \n\
           gopkg.in/natefinch/lumberjack.v2 v2.0.0 \n\
           gopkg.in/segmentio/analytics-go.v3 v3.1.0 \n\
           gotest.tools v2.2.0+incompatible \n\
    	   rogchap.com/v8go v0.7.0 \n\
           ) \n\
           \n\
           require ( \n\
           cloud.google.com/go v0.93.3 // indirect \n\
           github.com/Azure/go-ansiterm v0.0.0-20170929234023-d6e3b3328b78 // indirect \n\
           github.com/Microsoft/go-winio v0.4.17-0.20210211115548-6eac466e5fa3 // indirect \n\
           github.com/Microsoft/hcsshim v0.8.16 // indirect \n\
           github.com/StackExchange/wmi v1.2.1 // indirect \n\
           github.com/VividCortex/ewma v1.2.0 // indirect \n\
           github.com/acarl005/stripansi v0.0.0-20180116102854-5a71ef0e047d // indirect \n\
           github.com/apache/arrow/go/arrow v0.0.0-20200601151325-b2287a20f230 // indirect \n\
           github.com/apache/thrift v0.13.1-0.20201008052519-daf620915714 // indirect \n\
           github.com/beeker1121/goque v2.1.0+incompatible // indirect \n\
           github.com/beorn7/perks v1.0.1 // indirect \n\
           github.com/cenkalti/backoff v2.2.1+incompatible // indirect \n\
           github.com/cespare/xxhash/v2 v2.1.1 // indirect \n\
           github.com/containerd/cgroups v0.0.0-20210114181951-8a68de567b68 // indirect \n\
           github.com/containerd/containerd v1.5.0-beta.4 // indirect \n\
           github.com/coreos/go-semver v0.3.0 // indirect \n\
           github.com/coreos/go-systemd/v22 v22.3.2 // indirect \n\
           github.com/davecgh/go-spew v1.1.1 // indirect \n\
           github.com/dgrijalva/jwt-go v3.2.0+incompatible // indirect \n\
           github.com/dlclark/regexp2 v1.4.1-0.20201116162257-a2a8dda75c91 // indirect \n\
           github.com/docker/distribution v2.7.1+incompatible // indirect \n\
           github.com/docker/go-units v0.4.0 // indirect \n\
           github.com/fsnotify/fsnotify v1.4.9 // indirect \n\
           github.com/gin-contrib/sse v0.1.0 // indirect \n\
           github.com/go-ole/go-ole v1.2.5 // indirect \n\
           github.com/go-playground/locales v0.13.0 // indirect \n\
           github.com/go-playground/universal-translator v0.17.0 // indirect \n\
           github.com/go-playground/validator/v10 v10.4.1 // indirect \n\
           github.com/go-sourcemap/sourcemap v2.1.3+incompatible // indirect \n\
           github.com/gofrs/flock v0.7.1 // indirect \n\
           github.com/gogo/protobuf v1.3.2 // indirect \n\
           github.com/golang/groupcache v0.0.0-20200121045136-8c9f03a8e57e // indirect \n\
           github.com/golang/protobuf v1.5.2 // indirect \n\
           github.com/golang/snappy v0.0.3 // indirect \n\
           github.com/google/flatbuffers v1.11.0 // indirect \n\
           github.com/google/go-querystring v1.0.0 // indirect \n\
           github.com/googleapis/gax-go/v2 v2.1.0 // indirect \n\
           github.com/hashicorp/errwrap v1.0.0 // indirect \n\
           github.com/hashicorp/hcl v1.0.0 // indirect \n\
           github.com/inconshreveable/mousetrap v1.0.0 // indirect \n\
           github.com/jmespath/go-jmespath v0.4.0 // indirect \n\
           github.com/json-iterator/go v1.1.11 // indirect \n\
           github.com/klauspost/compress v1.11.3 // indirect \n\
           github.com/leodido/go-urn v1.2.0 // indirect \n\
           github.com/lucasb-eyer/go-colorful v1.2.0 // indirect \n\
           github.com/magiconair/properties v1.8.5 // indirect \n\
           github.com/mattn/go-isatty v0.0.12 // indirect \n\
           github.com/mattn/go-runewidth v0.0.13 // indirect \n\
           github.com/matttproud/golang_protobuf_extensions v1.0.2-0.20181231171920-c182affec369 // indirect \n\
           github.com/moby/sys/mount v0.2.0 // indirect \n\
           github.com/moby/sys/mountinfo v0.5.0 // indirect \n\
           github.com/moby/term v0.0.0-20201216013528-df9cb8a40635 // indirect \n\
           github.com/modern-go/concurrent v0.0.0-20180306012644-bacd9c7ef1dd // indirect \n\
           github.com/modern-go/reflect2 v1.0.1 // indirect \n\
           github.com/morikuni/aec v0.0.0-20170113033406-39771216ff4c // indirect \n\
           github.com/muesli/reflow v0.2.1-0.20210115123740-9e1d0d53df68 // indirect \n\
           github.com/muesli/termenv v0.8.1 // indirect \n\
           github.com/opencontainers/go-digest v1.0.0 // indirect \n\
           github.com/opencontainers/image-spec v1.0.1 // indirect \n\
           github.com/opencontainers/runc v1.0.2 // indirect \n\
           github.com/oschwald/maxminddb-golang v1.6.0 // indirect \n\
           github.com/pelletier/go-toml v1.9.3 // indirect \n\
           github.com/pierrec/lz4/v4 v4.1.6 // indirect \n\
           github.com/pkg/browser v0.0.0-20180916011732-0a3d74bf9ce4 // indirect \n\
           github.com/pkg/errors v0.9.1 // indirect \n\
           github.com/pmezard/go-difflib v1.0.0 // indirect \n\
           github.com/prometheus/client_model v0.2.0 // indirect \n\
           github.com/prometheus/common v0.10.0 // indirect \n\
           github.com/prometheus/procfs v0.6.0 // indirect \n\
           github.com/rivo/uniseg v0.2.0 // indirect \n\
           github.com/segmentio/backo-go v0.0.0-20200129164019-23eae7c10bd3 // indirect \n\
           github.com/sirupsen/logrus v1.8.1 // indirect \n\
           github.com/snowflakedb/glog v0.0.0-20180824191149-f5055e6f21ce // indirect \n\
           github.com/spf13/afero v1.6.0 // indirect \n\
           github.com/spf13/jwalterweatherman v1.1.0 // indirect \n\
           github.com/spf13/pflag v1.0.5 // indirect \n\
           github.com/subosito/gotenv v1.2.0 // indirect \n\
           github.com/syndtr/goleveldb v1.0.0 // indirect \n\
           github.com/tklauser/go-sysconf v0.3.9 // indirect \n\
           github.com/tklauser/numcpus v0.3.0 // indirect \n\
           github.com/ugorji/go/codec v1.1.7 // indirect \n\
           github.com/xtgo/uuid v0.0.0-20140804021211-a0b114877d4c // indirect \n\
           go.etcd.io/etcd/api/v3 v3.5.0 // indirect \n\
           go.etcd.io/etcd/pkg/v3 v3.5.0-alpha.0 // indirect \n\
           go.opencensus.io v0.23.0 // indirect \n\
           go.uber.org/multierr v1.6.0 // indirect \n\
           go.uber.org/zap v1.17.0 // indirect \n\
           golang.org/x/crypto v0.0.0-20210513164829-c07d793c2f9a // indirect \n\
           golang.org/x/sys v0.0.0-20211109184856-51b60fd695b3 // indirect \n\
           golang.org/x/text v0.3.6 // indirect \n\
           golang.org/x/xerrors v0.0.0-20200804184101-5ec99f83aff1 // indirect \n\
           google.golang.org/appengine v1.6.7 // indirect \n\
           google.golang.org/grpc v1.40.0 // indirect \n\
           google.golang.org/protobuf v1.27.1 // indirect \n\
           gopkg.in/ini.v1 v1.62.0 // indirect \n\
           gopkg.in/yaml.v2 v2.4.0 // indirect \n\
           gopkg.in/yaml.v3 v3.0.0-20210107192922-496545a6307b // indirect \n\
           ) \n\
           \n\
           replace ( \n\
           github.com/coreos/etcd => go.etcd.io/etcd/v3 v3.5.0-alpha.0 \n\
           google.golang.org/grpc v1.36.0 => google.golang.org/grpc v1.29.1 \n\
           )' > /go/src/github.com/deps/install/go.mod
RUN go mod download