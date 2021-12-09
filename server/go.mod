module github.com/jitsucom/jitsu/server

go 1.16

require (
	cloud.google.com/go/bigquery v1.8.0
	cloud.google.com/go/firestore v1.1.1
	cloud.google.com/go/storage v1.10.0
	firebase.google.com/go/v4 v4.1.0
	github.com/FZambia/sentinel v1.1.0
	github.com/Shopify/sarama v1.30.0
	github.com/aws/aws-sdk-go v1.34.0
	github.com/beeker1121/goque v2.1.0+incompatible // indirect
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
	github.com/google/martian v2.1.0+incompatible
	github.com/google/uuid v1.3.0
	github.com/gookit/color v1.3.1
	github.com/hashicorp/go-multierror v1.1.0
	github.com/huandu/facebook/v2 v2.5.3
	github.com/iancoleman/strcase v0.2.0
	github.com/jitsucom/goque/v2 v2.2.0
	github.com/joncrlsn/dque v0.0.0-20200702023911-3e80e3146ce5
	github.com/lib/pq v1.10.2
	github.com/logrusorgru/aurora v2.0.3+incompatible
	github.com/mailru/go-clickhouse v1.3.0
	github.com/mitchellh/hashstructure/v2 v2.0.1
	github.com/mitchellh/mapstructure v1.4.1
	github.com/olekukonko/tablewriter v0.0.4
	github.com/oschwald/geoip2-golang v1.4.0
	github.com/panjf2000/ants/v2 v2.4.6
	github.com/prometheus/client_golang v1.7.1
	github.com/robfig/cron/v3 v3.0.1
	github.com/satori/go.uuid v1.2.0
	github.com/segmentio/backo-go v0.0.0-20200129164019-23eae7c10bd3 // indirect
	github.com/shirou/gopsutil/v3 v3.21.9
	github.com/smartystreets/assertions v1.2.1
	github.com/snowflakedb/gosnowflake v1.3.8
	github.com/spf13/cast v1.3.1
	github.com/spf13/cobra v1.2.1
	github.com/spf13/viper v1.8.1
	github.com/stretchr/testify v1.7.0
	github.com/testcontainers/testcontainers-go v0.12.0
	github.com/ua-parser/uap-go v0.0.0-20200325213135-e1c09f13e2fe
	github.com/vbauerster/mpb/v7 v7.1.3
	github.com/xdg-go/scram v1.0.2
	github.com/xitongsys/parquet-go v1.6.1
	github.com/xitongsys/parquet-go-source v0.0.0-20211010230925-397910c5e371
	github.com/xtgo/uuid v0.0.0-20140804021211-a0b114877d4c // indirect
	go.etcd.io/etcd/client/v3 v3.5.0-alpha.0
	go.uber.org/atomic v1.7.0
	golang.org/x/crypto v0.0.0-20211117183948-ae814b36b871 // indirect
	golang.org/x/net v0.0.0-20211112202133-69e39bad7dc2
	golang.org/x/oauth2 v0.0.0-20210819190943-2bc19b11175f
	golang.org/x/term v0.0.0-20201126162022-7de9c90e9dd1
	google.golang.org/api v0.56.0
	google.golang.org/genproto v0.0.0-20210828152312-66f60bf46e71
	gopkg.in/natefinch/lumberjack.v2 v2.0.0
	gopkg.in/segmentio/analytics-go.v3 v3.1.0
	gotest.tools v2.2.0+incompatible
)

replace (
	github.com/coreos/etcd => go.etcd.io/etcd/v3 v3.5.0-alpha.0
	google.golang.org/grpc v1.36.0 => google.golang.org/grpc v1.29.1
)
