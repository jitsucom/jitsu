### JS/GO BUILDER
FROM golang:1.17.5-alpine3.15

# Install dependencies
RUN apk add git make bash npm yarn pnpm

# Install npm dependencies
RUN pnpm add global webpack @craco/craco@6.1.1 postcss@7 react@17.0.1 --prefer-offline

# GO
RUN mkdir -p /go/src/github.com/deps/install

WORKDIR /go/src/github.com/deps/install

RUN echo $'\n\
           module github.com/deps/install \n\
           \n\
           go 1.17\n\
           \n\
           require (\n\
             cloud.google.com/go/firestore v1.3.0 \n\
             firebase.google.com/go/v4 v4.1.0 \n\
             github.com/bramvdbogaerde/go-scp v0.0.0-20200820121624-ded9ee94aef5 \n\
             github.com/dgrijalva/jwt-go v3.2.0+incompatible \n\
             github.com/gin-gonic/contrib v0.0.0-20201101042839-6a891bf89f19 \n\
             github.com/gin-gonic/gin v1.7.3 \n\
             github.com/go-acme/lego v2.7.2+incompatible \n\
             github.com/gomodule/redigo v1.8.2 \n\
             github.com/hashicorp/go-multierror v1.1.0 \n\
             github.com/lib/pq v1.10.2 \n\
             github.com/mitchellh/mapstructure v1.4.1 \n\
             github.com/satori/go.uuid v1.2.0 \n\
             github.com/spf13/viper v1.8.1 \n\
             golang.org/x/crypto v0.0.0-20210513164829-c07d793c2f9a \n\
             google.golang.org/api v0.56.0 \n\
             google.golang.org/grpc v1.40.0 \n\
             gopkg.in/mail.v2 v2.3.1 \n\
             gopkg.in/yaml.v3 v3.0.0-20210107192922-496545a6307b \n\
           ) \n\
           \n\
           require ( \n\
             cloud.google.com/go v0.93.3 // indirect \n\
             cloud.google.com/go/bigquery v1.8.0 // indirect \n\
             cloud.google.com/go/storage v1.10.0 // indirect \n\
             github.com/FZambia/sentinel v1.1.0 // indirect \n\
             github.com/Microsoft/go-winio v0.4.17-0.20210211115548-6eac466e5fa3 // indirect \n\
             github.com/StackExchange/wmi v1.2.1 // indirect \n\
             github.com/apache/arrow/go/arrow v0.0.0-20200601151325-b2287a20f230 // indirect \n\
             github.com/apache/thrift v0.13.1-0.20201008052519-daf620915714 // indirect \n\
             github.com/aws/aws-sdk-go v1.34.0 // indirect \n\
             github.com/beorn7/perks v1.0.1 // indirect \n\
             github.com/cenkalti/backoff v2.2.1+incompatible // indirect \n\
             github.com/cespare/xxhash/v2 v2.1.1 // indirect \n\
             github.com/charmbracelet/lipgloss v0.2.1 // indirect \n\
             github.com/containerd/containerd v1.5.0-beta.4 // indirect \n\
             github.com/dlclark/regexp2 v1.4.1-0.20201116162257-a2a8dda75c91 // indirect \n\
             github.com/docker/distribution v2.7.1+incompatible // indirect \n\
             github.com/docker/docker v20.10.11+incompatible // indirect \n\
             github.com/docker/go-connections v0.4.0 // indirect \n\
             github.com/docker/go-units v0.4.0 // indirect \n\
             github.com/dop251/goja v0.0.0-20211022113120-dc8c55024d06 // indirect \n\
             github.com/fsnotify/fsnotify v1.4.9 // indirect \n\
             github.com/gin-contrib/sse v0.1.0 // indirect \n\
             github.com/go-ole/go-ole v1.2.5 // indirect \n\
             github.com/go-playground/locales v0.13.0 // indirect \n\
             github.com/go-playground/universal-translator v0.17.0 // indirect \n\
             github.com/go-playground/validator/v10 v10.4.1 // indirect \n\
             github.com/go-sourcemap/sourcemap v2.1.3+incompatible // indirect \n\
             github.com/go-sql-driver/mysql v1.6.0 // indirect \n\
             github.com/gofrs/flock v0.7.1 // indirect \n\
             github.com/gogo/protobuf v1.3.2 // indirect \n\
             github.com/golang/groupcache v0.0.0-20200121045136-8c9f03a8e57e // indirect \n\
             github.com/golang/protobuf v1.5.2 // indirect \n\
             github.com/golang/snappy v0.0.3 // indirect \n\
             github.com/google/flatbuffers v1.11.0 // indirect \n\
             github.com/google/go-cmp v0.5.6 // indirect \n\
             github.com/google/go-github/v32 v32.1.0 // indirect \n\
             github.com/google/go-querystring v1.0.0 // indirect \n\
             github.com/google/martian v2.1.0+incompatible // indirect \n\
             github.com/google/uuid v1.3.0 // indirect \n\
             github.com/googleapis/gax-go/v2 v2.1.0 // indirect \n\
             github.com/gookit/color v1.3.1 // indirect \n\
             github.com/hashicorp/errwrap v1.0.0 // indirect \n\
             github.com/hashicorp/hcl v1.0.0 // indirect \n\
             github.com/huandu/facebook/v2 v2.5.3 // indirect \n\
             github.com/iancoleman/strcase v0.2.0 // indirect \n\
             github.com/jitsucom/goque/v2 v2.2.0 // indirect \n\
             github.com/jmespath/go-jmespath v0.4.0 // indirect \n\
             github.com/joncrlsn/dque v0.0.0-20200702023911-3e80e3146ce5 // indirect \n\
             github.com/json-iterator/go v1.1.11 // indirect \n\
             github.com/klauspost/compress v1.11.3 // indirect \n\
             github.com/leodido/go-urn v1.2.0 // indirect \n\
             github.com/lucasb-eyer/go-colorful v1.2.0 // indirect \n\
             github.com/magiconair/properties v1.8.5 // indirect \n\
             github.com/mailru/go-clickhouse v1.3.0 // indirect \n\
             github.com/mattn/go-isatty v0.0.12 // indirect \n\
             github.com/mattn/go-runewidth v0.0.13 // indirect \n\
             github.com/matttproud/golang_protobuf_extensions v1.0.2-0.20181231171920-c182affec369 // indirect \n\
             github.com/miekg/dns v1.0.14 // indirect \n\
             github.com/mitchellh/hashstructure/v2 v2.0.1 // indirect \n\
             github.com/modern-go/concurrent v0.0.0-20180306012644-bacd9c7ef1dd // indirect \n\
             github.com/modern-go/reflect2 v1.0.1 // indirect \n\
             github.com/muesli/reflow v0.2.1-0.20210115123740-9e1d0d53df68 // indirect \n\
             github.com/muesli/termenv v0.8.1 // indirect \n\
             github.com/onsi/ginkgo v1.14.1 // indirect \n\
             github.com/onsi/gomega v1.10.2 // indirect \n\
             github.com/opencontainers/go-digest v1.0.0 // indirect \n\
             github.com/opencontainers/image-spec v1.0.1 // indirect \n\
             github.com/oschwald/geoip2-golang v1.4.0 // indirect \n\
             github.com/oschwald/maxminddb-golang v1.6.0 // indirect \n\
             github.com/panjf2000/ants/v2 v2.4.6 // indirect \n\
             github.com/pelletier/go-toml v1.9.3 // indirect \n\
             github.com/pierrec/lz4/v4 v4.1.6 // indirect \n\
             github.com/pkg/browser v0.0.0-20180916011732-0a3d74bf9ce4 // indirect \n\
             github.com/pkg/errors v0.9.1 // indirect \n\
             github.com/prometheus/client_golang v1.7.1 // indirect \n\
             github.com/prometheus/client_model v0.2.0 // indirect \n\
             github.com/prometheus/common v0.15.0 // indirect \n\
             github.com/prometheus/procfs v0.6.0 // indirect \n\
             github.com/rivo/uniseg v0.2.0 // indirect \n\
             github.com/robfig/cron/v3 v3.0.1 // indirect \n\
             github.com/shirou/gopsutil/v3 v3.21.9 // indirect \n\
             github.com/sirupsen/logrus v1.8.1 // indirect \n\
             github.com/snowflakedb/glog v0.0.0-20180824191149-f5055e6f21ce // indirect \n\
             github.com/snowflakedb/gosnowflake v1.3.8 // indirect \n\
             github.com/spf13/afero v1.6.0 // indirect \n\
             github.com/spf13/cast v1.3.1 // indirect \n\
             github.com/spf13/jwalterweatherman v1.1.0 // indirect \n\
             github.com/spf13/pflag v1.0.5 // indirect \n\
             github.com/subosito/gotenv v1.2.0 // indirect \n\
             github.com/syndtr/goleveldb v1.0.0 // indirect \n\
             github.com/tklauser/go-sysconf v0.3.9 // indirect \n\
             github.com/tklauser/numcpus v0.3.0 // indirect \n\
             github.com/ua-parser/uap-go v0.0.0-20200325213135-e1c09f13e2fe // indirect \n\
             github.com/ugorji/go/codec v1.1.7 // indirect \n\
             github.com/xitongsys/parquet-go v1.6.1 // indirect \n\
             github.com/xitongsys/parquet-go-source v0.0.0-20211010230925-397910c5e371 // indirect \n\
             go.opencensus.io v0.23.0 // indirect \n\
             go.uber.org/atomic v1.7.0 // indirect \n\
             golang.org/x/net v0.0.0-20211108170745-6635138e15ea // indirect \n\
             golang.org/x/oauth2 v0.0.0-20210819190943-2bc19b11175f // indirect \n\
             golang.org/x/sys v0.0.0-20211109184856-51b60fd695b3 // indirect \n\
             golang.org/x/term v0.0.0-20201126162022-7de9c90e9dd1 // indirect \n\
             golang.org/x/text v0.3.6 // indirect \n\
             golang.org/x/xerrors v0.0.0-20200804184101-5ec99f83aff1 // indirect \n\
             google.golang.org/appengine v1.6.7 // indirect \n\
             google.golang.org/genproto v0.0.0-20210828152312-66f60bf46e71 // indirect \n\
             google.golang.org/protobuf v1.27.1 // indirect \n\
             gopkg.in/alexcesaro/quotedprintable.v3 v3.0.0-20150716171945-2caba252f4dc // indirect \n\
             gopkg.in/ini.v1 v1.62.0 // indirect \n\
             gopkg.in/natefinch/lumberjack.v2 v2.0.0 // indirect \n\
             gopkg.in/square/go-jose.v2 v2.5.1 // indirect \n\
             gopkg.in/yaml.v2 v2.4.0 // indirect \n\
           ) \n\
           \n\
           replace ( \n\
             google.golang.org/api v0.17.0 => google.golang.org/api v0.15.1 \n\
             google.golang.org/grpc v1.27.0 => google.golang.org/grpc v1.26.0 \n\
           )' > /go/src/github.com/deps/install/go.mod
RUN go mod download