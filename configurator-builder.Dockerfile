### JS/GO BUILDER
FROM golang:1.16.3-alpine3.13

# Install dependencies
RUN apk add git make bash npm yarn

# Install yarn dependencies
RUN yarn add global webpack @craco/craco@6.1.1 postcss@7 react@17.0.1 --prefer-offline --frozen-lockfile --network-timeout 1000000

# GO
RUN mkdir -p /go/src/github.com/deps/install

WORKDIR /go/src/github.com/deps/install

RUN echo $'\n\
module github.com/deps/install \n\
\n\
go 1.16\n\
\n\
require (\n\
	cloud.google.com/go/firestore v1.3.0\n\
	firebase.google.com/go/v4 v4.1.0\n\
	github.com/bramvdbogaerde/go-scp v0.0.0-20200820121624-ded9ee94aef5\n\
	github.com/dgrijalva/jwt-go v3.2.0+incompatible\n\
	github.com/gin-gonic/contrib v0.0.0-20201101042839-6a891bf89f19\n\
	github.com/gin-gonic/gin v1.6.3\n\
	github.com/go-acme/lego v2.7.2+incompatible\n\
	github.com/gomodule/redigo v1.8.2\n\
	github.com/hashicorp/go-multierror v1.1.0\n\
	github.com/prometheus/common v0.15.0 // indirect\n\
	github.com/satori/go.uuid v1.2.0\n\
	github.com/spf13/viper v1.7.1\n\
	golang.org/x/crypto v0.0.0-20201016220609-9e8e0b390897\n\
	google.golang.org/api v0.29.0\n\
	google.golang.org/grpc v1.36.0\n\
	gopkg.in/alexcesaro/quotedprintable.v3 v3.0.0-20150716171945-2caba252f4dc // indirect\n\
	gopkg.in/mail.v2 v2.3.1\n\
	gopkg.in/square/go-jose.v2 v2.5.1 // indirect\n\
	gopkg.in/yaml.v3 v3.0.0-20200615113413-eeeca48fe776\n\
)\n\
\n\
replace (\n\
	google.golang.org/api v0.17.0 => google.golang.org/api v0.15.1\n\
	google.golang.org/grpc v1.27.0 => google.golang.org/grpc v1.26.0\n\
)\n\
' > /go/src/github.com/deps/install/go.mod
RUN go mod download