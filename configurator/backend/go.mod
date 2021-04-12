module github.com/jitsucom/jitsu/configurator

go 1.14

require (
	cloud.google.com/go/firestore v1.3.0
	firebase.google.com/go/v4 v4.1.0
	github.com/bramvdbogaerde/go-scp v0.0.0-20200820121624-ded9ee94aef5
	github.com/dgrijalva/jwt-go v3.2.0+incompatible
	github.com/gin-gonic/contrib v0.0.0-20201101042839-6a891bf89f19
	github.com/gin-gonic/gin v1.6.3
	github.com/go-acme/lego v2.7.2+incompatible
	github.com/gomodule/redigo v1.8.2
	github.com/hashicorp/go-multierror v1.1.0
	github.com/jitsucom/jitsu/server v1.28.2
	github.com/prometheus/common v0.15.0 // indirect
	github.com/satori/go.uuid v1.1.0
	github.com/spf13/viper v1.7.1
	golang.org/x/crypto v0.0.0-20201016220609-9e8e0b390897
	google.golang.org/api v0.29.0
	google.golang.org/grpc v1.36.0
	gopkg.in/alexcesaro/quotedprintable.v3 v3.0.0-20150716171945-2caba252f4dc // indirect
	gopkg.in/mail.v2 v2.3.1
	gopkg.in/square/go-jose.v2 v2.5.1 // indirect
	gopkg.in/yaml.v3 v3.0.0-20200615113413-eeeca48fe776
)

replace (
	github.com/jitsucom/jitsu/server => ./../../server
	google.golang.org/api v0.17.0 => google.golang.org/api v0.15.1
	google.golang.org/grpc v1.27.0 => google.golang.org/grpc v1.26.0
)
