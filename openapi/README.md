# OpenAPI generation

## Getting started

Jitsu uses [oapi-codegen](https://github.com/deepmap/oapi-codegen) project for generating GO code and [@openapitools/openapi-generator-cli](https://github.com/OpenAPITools/openapi-generator-cli) npm package for generating typescript code. 

### Setup

1. make sure that you have installed `npm` and `go`;
2. install `openapi-generator-cli`: `npm i -g @openapitools/openapi-generator-cli`
3. check installed generator: `openapi-generator-cli version`. Output: `sburykin@Sergeys-MacBook-Pro openapi % openapi-generator-cli version
   5.3.1
   `
4. install [oapi-codegen](https://github.com/deepmap/oapi-codegen): `go get github.com/deepmap/oapi-codegen/cmd/oapi-codegen`

### Generate GO code

1. go to `openapi` dir: cd `jitsu/openapi`
[//]: 2. generate GO HTTP server for `gin` framework: `openapi-generator-cli generate -g go-gin-server -i configurator.yaml -o ../configurator/backend/openapi/`
2. generate code:
```bash
$GOPATH/bin/oapi-codegen -generate gin -package openapi -o ../configurator/backend/openapi/routers-gen.go configurator.yaml
$GOPATH/bin/oapi-codegen -generate types -package openapi -o ../configurator/backend/openapi/types-gen.go configurator.yaml
```
3. replace all `msg` field with "message" in routers-gen.go:
4. replace `type MiddlewareFunc MiddlewareFunc` with `type MiddlewareFunc func(c *gin.Context)`