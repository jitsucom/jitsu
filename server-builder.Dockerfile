### JS/GO BUILDER
FROM golang:1.17.5-alpine3.15

# Install dependencies
RUN apk add git make bash npm yarn

# Install yarn dependencies
RUN yarn add global tslib@2.2.0 rollup@2.44.0 typescript@4.2.3 ts-node@9.1.1 jest@26.6.3 jest-fetch-mock@3.0.3 --prefer-offline --frozen-lockfile --network-timeout 1000000

# GO
RUN mkdir -p /go/src/github.com/deps/install

WORKDIR /go/src/github.com/deps/install

RUN echo $'\n\
module github.com/deps/install \n\
\n\
go 1.17 \n\
\n\
require ( \n\
	bou.ke/monkey v1.0.2 \n\
	cloud.google.com/go/bigquery v1.4.0 \n\
	cloud.google.com/go/firestore v1.1.1 \n\
	cloud.google.com/go/storage v1.6.0 \n\
	firebase.google.com/go/v4 v4.1.0 \n\
	github.com/aws/aws-sdk-go v1.34.0 \n\
	github.com/charmbracelet/lipgloss v0.2.1 \n\
	github.com/docker/go-connections v0.4.0 \n\
	github.com/gin-gonic/gin v1.6.3 \n\
	github.com/go-redsync/redsync/v4 v4.3.0 \n\
	github.com/gomodule/redigo v1.8.2 \n\
	github.com/google/go-github/v32 v32.1.0 \n\
	github.com/google/martian v2.1.0+incompatible \n\
	github.com/google/uuid v1.2.0 \n\
	github.com/gookit/color v1.3.1 \n\
	github.com/hashicorp/go-multierror v1.1.0 \n\
	github.com/huandu/facebook/v2 v2.5.3 \n\
	github.com/joncrlsn/dque v0.0.0-20200702023911-3e80e3146ce5 \n\
	github.com/lib/pq v1.8.0 \n\
	github.com/mailru/easyjson v0.7.7 \n\
	github.com/mailru/go-clickhouse v1.3.0 \n\
	github.com/mitchellh/hashstructure/v2 v2.0.1 \n\
	github.com/oschwald/geoip2-golang v1.4.0 \n\
	github.com/panjf2000/ants/v2 v2.4.3 \n\
	github.com/prometheus/client_golang v1.7.1 \n\
	github.com/robfig/cron/v3 v3.0.1 \n\
	github.com/satori/go.uuid v1.2.0 \n\
	github.com/snowflakedb/gosnowflake v1.3.8 \n\
	github.com/spf13/cast v1.3.0 \n\
	github.com/spf13/viper v1.7.1 \n\
	github.com/stretchr/testify v1.7.0 \n\
	github.com/testcontainers/testcontainers-go v0.12.0 \n\
	github.com/ua-parser/uap-go v0.0.0-20200325213135-e1c09f13e2fe \n\
	go.etcd.io/etcd/client/v3 v3.5.0-alpha.0 \n\
	go.opencensus.io v0.22.4 // indirect \n\
	go.uber.org/atomic v1.6.0 \n\
	golang.org/x/term v0.0.0-20201126162022-7de9c90e9dd1 \n\
	google.golang.org/api v0.20.0 \n\
	google.golang.org/appengine v1.6.6 // indirect \n\
	google.golang.org/grpc v1.36.0 // indirect \n\
	gopkg.in/natefinch/lumberjack.v2 v2.0.0 \n\
	gotest.tools v2.2.0+incompatible \n\
	honnef.co/go/tools v0.0.1-2020.1.4 // indirect \n\
) \n\
 \n\
replace ( \n\
	github.com/coreos/etcd => go.etcd.io/etcd/v3 v3.5.0-alpha.0 \n\
	google.golang.org/grpc v1.36.0 => google.golang.org/grpc v1.29.1 \n\
)' > /go/src/github.com/deps/install/go.mod
RUN go mod download