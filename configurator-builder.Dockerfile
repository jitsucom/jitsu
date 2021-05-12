### JS/GO BUILDER
FROM golang:1.16.3-alpine3.13

# Install dependencies
RUN apk add git make bash npm yarn

# Install yarn dependencies
RUN yarn add global @craco/craco@6.1.1 postcss@7 react@17.0.1 --prefer-offline --frozen-lockfile --network-timeout 1000000

# GO
RUN mkdir -p /go/src/github.com/jitsucom/jitsu/configurator/backend && \
    mkdir -p /go/src/github.com/jitsucom/jitsu/server

WORKDIR /go/src/github.com/jitsucom/jitsu/configurator/backend

ADD configurator/backend/go.mod ./
ADD server/go.mod /go/src/github.com/jitsucom/jitsu/server/
RUN go mod download