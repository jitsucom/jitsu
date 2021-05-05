### JS/GO BUILDER
FROM golang:1.16.3-alpine3.13

# Install dependencies
RUN apk add git make bash npm yarn

# JS
RUN mkdir /frontend
WORKDIR /frontend

# Install yarn dependencies
ADD configurator/frontend/package.json configurator/frontend/yarn.lock /frontend/
RUN yarn install --prefer-offline --frozen-lockfile --network-timeout 1000000

# GO
RUN mkdir -p /go/src/github.com/jitsucom/jitsu/configurator/backend && \
    mkdir -p /go/src/github.com/jitsucom/jitsu/server

WORKDIR /go/src/github.com/jitsucom/jitsu/configurator/backend

ADD configurator/backend/go.mod configurator/backend/go.sum ./
ADD server/go.mod server/go.sum /go/src/github.com/jitsucom/jitsu/server/
RUN go mod download