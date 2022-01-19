# OpenAPI generation

## Getting started

Jitsu uses [oapi-codegen](https://github.com/deepmap/oapi-codegen) project for generating GO code and [@openapitools/openapi-generator-cli](https://github.com/OpenAPITools/openapi-generator-cli) npm package for generating typescript code. 

### Setup

1. make sure that you have installed `npm` and `go`;
2. install `openapi-generator-cli`: `npm i -g @openapitools/openapi-generator-cli`
3. install [oapi-codegen](https://github.com/deepmap/oapi-codegen): `go get github.com/deepmap/oapi-codegen/cmd/oapi-codegen`

### Generate GO code

1. go to the root `jitsu` project directory
2. generate code:
```bash
$GOPATH/bin/oapi-codegen -templates openapi/templates -generate gin -package openapi -o configurator/backend/openapi/routers-gen.go openapi/configurator.yaml
$GOPATH/bin/oapi-codegen -generate types -package openapi -o configurator/backend/openapi/types-gen.go openapi/configurator.yaml
```