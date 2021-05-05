### JS/GO BUILDER
FROM golang:1.16.3-alpine3.13

# Install dependencies
RUN apk add git make bash npm yarn

# JS
RUN mkdir /javascript-sdk
WORKDIR /javascript-sdk

# Install yarn dependencies
ADD javascript-sdk/package.json javascript-sdk/yarn.lock ./
RUN yarn install --prefer-offline --frozen-lockfile --network-timeout 1000000

# GO
RUN mkdir -p /go/src/github.com/jitsucom/jitsu/server

WORKDIR /go/src/github.com/jitsucom/jitsu/server

ADD server/go.mod server/go.sum /go/src/github.com/jitsucom/jitsu/server/
RUN go mod download