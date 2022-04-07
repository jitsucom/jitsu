module github.com/jitsucom/jitsu/server

go 1.17

require (
	cloud.google.com/go/bigquery v1.8.0
	cloud.google.com/go/firestore v1.1.1
	cloud.google.com/go/storage v1.10.0
	firebase.google.com/go/v4 v4.1.0
	github.com/FZambia/sentinel v1.1.0
	github.com/Masterminds/semver v1.5.0
	github.com/aws/aws-sdk-go v1.34.0
	github.com/carlmjohnson/requests v0.22.1
	github.com/cespare/xxhash/v2 v2.1.2 // indirect
	github.com/charmbracelet/lipgloss v0.2.1
	github.com/docker/docker v20.10.11+incompatible
	github.com/docker/go-connections v0.4.0
	github.com/dop251/goja v0.0.0-20211022113120-dc8c55024d06
	github.com/gin-gonic/gin v1.7.3
	github.com/go-redsync/redsync/v4 v4.3.0
	github.com/go-sql-driver/mysql v1.6.0
	github.com/gomodule/redigo v1.8.2
	github.com/google/go-cmp v0.5.6
	github.com/google/go-github/v32 v32.1.0
	github.com/google/go-querystring v1.1.0 // indirect
	github.com/google/martian v2.1.0+incompatible
	github.com/google/uuid v1.3.0
	github.com/gookit/color v1.3.1
	github.com/hashicorp/go-multierror v1.1.0
	github.com/huandu/facebook/v2 v2.5.3
	github.com/iancoleman/strcase v0.2.0
	github.com/jarcoal/httpmock v1.1.0
	github.com/lib/pq v1.10.2
	github.com/logrusorgru/aurora v2.0.3+incompatible
	github.com/mailru/go-clickhouse v1.8.0
	github.com/mitchellh/hashstructure/v2 v2.0.2
	github.com/mitchellh/mapstructure v1.4.1
	github.com/olekukonko/tablewriter v0.0.4
	github.com/oschwald/geoip2-golang v1.4.0
	github.com/panjf2000/ants/v2 v2.4.6
	github.com/penglongli/gin-metrics v0.1.9
	github.com/phayes/freeport v0.0.0-20180830031419-95f893ade6f2
	github.com/pkg/errors v0.9.1
	github.com/prometheus/client_golang v1.11.0
	github.com/prometheus/client_model v0.2.0
	github.com/prometheus/common v0.32.1 // indirect
	github.com/prometheus/procfs v0.7.3 // indirect
	github.com/robfig/cron/v3 v3.0.1
	github.com/satori/go.uuid v1.2.0
	github.com/shirou/gopsutil/v3 v3.21.9
	github.com/snowflakedb/gosnowflake v1.3.8
	github.com/spf13/cast v1.3.1
	github.com/spf13/cobra v1.2.1
	github.com/spf13/viper v1.8.1
	github.com/stretchr/testify v1.7.0
	github.com/testcontainers/testcontainers-go v0.12.0
	github.com/ua-parser/uap-go v0.0.0-20200325213135-e1c09f13e2fe
	github.com/vbauerster/mpb/v7 v7.3.1
	github.com/xitongsys/parquet-go v1.6.1
	github.com/xitongsys/parquet-go-source v0.0.0-20211010230925-397910c5e371
	go.uber.org/atomic v1.7.0
	golang.org/x/net v0.0.0-20211108170745-6635138e15ea
	golang.org/x/oauth2 v0.0.0-20210819190943-2bc19b11175f
	golang.org/x/term v0.0.0-20201126162022-7de9c90e9dd1
	golang.org/x/text v0.3.7 // indirect
	google.golang.org/api v0.56.0
	google.golang.org/genproto v0.0.0-20210828152312-66f60bf46e71
	gopkg.in/natefinch/lumberjack.v2 v2.0.0
	gopkg.in/segmentio/analytics-go.v3 v3.1.0
	gotest.tools v2.2.0+incompatible
	rogchap.com/v8go v0.7.1-0.20220112220650-5e91d3d9dcab
)

require (
	github.com/joomcode/errorx v1.1.0
	github.com/siadat/ipc v1.0.0
)

require (
	cloud.google.com/go v0.93.3 // indirect
	github.com/Azure/go-ansiterm v0.0.0-20170929234023-d6e3b3328b78 // indirect
	github.com/Microsoft/go-winio v0.4.17-0.20210211115548-6eac466e5fa3 // indirect
	github.com/Microsoft/hcsshim v0.8.16 // indirect
	github.com/StackExchange/wmi v1.2.1 // indirect
	github.com/VividCortex/ewma v1.2.0 // indirect
	github.com/acarl005/stripansi v0.0.0-20180116102854-5a71ef0e047d // indirect
	github.com/apache/arrow/go/arrow v0.0.0-20200601151325-b2287a20f230 // indirect
	github.com/apache/thrift v0.13.1-0.20201008052519-daf620915714 // indirect
	github.com/beorn7/perks v1.0.1 // indirect
	github.com/cenkalti/backoff v2.2.1+incompatible // indirect
	github.com/containerd/cgroups v0.0.0-20210114181951-8a68de567b68 // indirect
	github.com/containerd/containerd v1.5.0-beta.4 // indirect
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/dgrijalva/jwt-go v3.2.0+incompatible // indirect
	github.com/dlclark/regexp2 v1.4.1-0.20201116162257-a2a8dda75c91 // indirect
	github.com/docker/distribution v2.7.1+incompatible // indirect
	github.com/docker/go-units v0.4.0 // indirect
	github.com/fsnotify/fsnotify v1.4.9 // indirect
	github.com/gin-contrib/sse v0.1.0 // indirect
	github.com/go-ole/go-ole v1.2.5 // indirect
	github.com/go-playground/locales v0.13.0 // indirect
	github.com/go-playground/universal-translator v0.17.0 // indirect
	github.com/go-playground/validator/v10 v10.4.1 // indirect
	github.com/go-sourcemap/sourcemap v2.1.3+incompatible // indirect
	github.com/gogo/protobuf v1.3.2 // indirect
	github.com/golang/groupcache v0.0.0-20200121045136-8c9f03a8e57e // indirect
	github.com/golang/protobuf v1.5.2 // indirect
	github.com/golang/snappy v0.0.3 // indirect
	github.com/google/flatbuffers v1.11.0 // indirect
	github.com/googleapis/gax-go/v2 v2.1.0 // indirect
	github.com/hashicorp/errwrap v1.0.0 // indirect
	github.com/hashicorp/hcl v1.0.0 // indirect
	github.com/inconshreveable/mousetrap v1.0.0 // indirect
	github.com/jmespath/go-jmespath v0.4.0 // indirect
	github.com/json-iterator/go v1.1.11 // indirect
	github.com/klauspost/compress v1.11.3 // indirect
	github.com/leodido/go-urn v1.2.0 // indirect
	github.com/lucasb-eyer/go-colorful v1.2.0 // indirect
	github.com/magiconair/properties v1.8.5 // indirect
	github.com/mattn/go-isatty v0.0.12 // indirect
	github.com/mattn/go-runewidth v0.0.13 // indirect
	github.com/matttproud/golang_protobuf_extensions v1.0.2-0.20181231171920-c182affec369 // indirect
	github.com/moby/sys/mount v0.2.0 // indirect
	github.com/moby/sys/mountinfo v0.5.0 // indirect
	github.com/moby/term v0.0.0-20201216013528-df9cb8a40635 // indirect
	github.com/modern-go/concurrent v0.0.0-20180306012644-bacd9c7ef1dd // indirect
	github.com/modern-go/reflect2 v1.0.1 // indirect
	github.com/morikuni/aec v0.0.0-20170113033406-39771216ff4c // indirect
	github.com/muesli/reflow v0.2.1-0.20210115123740-9e1d0d53df68 // indirect
	github.com/muesli/termenv v0.8.1 // indirect
	github.com/opencontainers/go-digest v1.0.0 // indirect
	github.com/opencontainers/image-spec v1.0.1 // indirect
	github.com/opencontainers/runc v1.0.2 // indirect
	github.com/oschwald/maxminddb-golang v1.6.0 // indirect
	github.com/pelletier/go-toml v1.9.3 // indirect
	github.com/pierrec/lz4/v4 v4.1.6 // indirect
	github.com/pkg/browser v0.0.0-20180916011732-0a3d74bf9ce4 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	github.com/rivo/uniseg v0.2.0 // indirect
	github.com/segmentio/backo-go v0.0.0-20200129164019-23eae7c10bd3 // indirect
	github.com/sirupsen/logrus v1.8.1 // indirect
	github.com/snowflakedb/glog v0.0.0-20180824191149-f5055e6f21ce // indirect
	github.com/spf13/afero v1.6.0 // indirect
	github.com/spf13/jwalterweatherman v1.1.0 // indirect
	github.com/spf13/pflag v1.0.5 // indirect
	github.com/subosito/gotenv v1.2.0 // indirect
	github.com/tklauser/go-sysconf v0.3.9 // indirect
	github.com/tklauser/numcpus v0.3.0 // indirect
	github.com/ugorji/go/codec v1.1.7 // indirect
	github.com/willf/bitset v1.1.11 // indirect
	github.com/xtgo/uuid v0.0.0-20140804021211-a0b114877d4c // indirect
	go.opencensus.io v0.23.0 // indirect
	golang.org/x/crypto v0.0.0-20210513164829-c07d793c2f9a // indirect
	golang.org/x/sys v0.0.0-20220114195835-da31bd327af9 // indirect
	golang.org/x/xerrors v0.0.0-20200804184101-5ec99f83aff1 // indirect
	google.golang.org/appengine v1.6.7 // indirect
	google.golang.org/grpc v1.40.0 // indirect
	google.golang.org/protobuf v1.27.1 // indirect
	gopkg.in/ini.v1 v1.62.0 // indirect
	gopkg.in/yaml.v2 v2.4.0 // indirect
	gopkg.in/yaml.v3 v3.0.0-20210107192922-496545a6307b // indirect
)

replace (
	github.com/coreos/etcd => go.etcd.io/etcd/v3 v3.5.0-alpha.0
	google.golang.org/grpc v1.36.0 => google.golang.org/grpc v1.29.1
)
