module github.com/jitsucom/jitsu/configurator

go 1.16

require (
	cloud.google.com/go/firestore v1.3.0
	firebase.google.com/go/v4 v4.1.0
	github.com/bramvdbogaerde/go-scp v0.0.0-20200820121624-ded9ee94aef5
	github.com/dgrijalva/jwt-go v3.2.0+incompatible
	github.com/gin-gonic/contrib v0.0.0-20201101042839-6a891bf89f19
	github.com/gin-gonic/gin v1.7.3
	github.com/go-acme/lego v2.7.2+incompatible
	github.com/gomodule/redigo v1.8.2
	github.com/hashicorp/go-multierror v1.1.0
	github.com/jitsucom/jitsu/server v1.37.3
	github.com/lib/pq v1.10.2
	github.com/mitchellh/mapstructure v1.4.1
	github.com/prometheus/common v0.15.0 // indirect
	github.com/satori/go.uuid v1.2.0
	github.com/spf13/viper v1.8.1
	golang.org/x/crypto v0.0.0-20210513164829-c07d793c2f9a
	google.golang.org/api v0.56.0
	google.golang.org/grpc v1.40.0
	gopkg.in/alexcesaro/quotedprintable.v3 v3.0.0-20150716171945-2caba252f4dc // indirect
	gopkg.in/mail.v2 v2.3.1
	gopkg.in/yaml.v3 v3.0.0-20210107192922-496545a6307b
)

replace (
	github.com/jitsucom/jitsu/server => ./../../server
	google.golang.org/api v0.17.0 => google.golang.org/api v0.15.1
	google.golang.org/grpc v1.27.0 => google.golang.org/grpc v1.26.0
)
