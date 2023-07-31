# OpenAPI generation

## Getting started

Jitsu uses [oapi-codegen](https://github.com/deepmap/oapi-codegen) project for generating GO code. OpenAPI golang files are generated 
on every configurator backend build (see Makefile: go_generate and main.go). **You don't have to do it manually**.

### Generate go code manually

If you would like to generate go code manually keep reading this section.

### Setup

1. make sure that you have installed `go` locally;
2. install [oapi-codegen](https://github.com/deepmap/oapi-codegen) v1.10.1: `go get github.com/deepmap/oapi-codegen/cmd/oapi-codegen@v1.10.1`

### Generate GO code

1. go to the root `jitsu` project directory
2. generate code:
```bash
$GOPATH/bin/oapi-codegen -templates openapi/templates -generate gin -package openapi -o configurator/backend/openapi/routers-gen.go openapi/configurator.yaml
$GOPATH/bin/oapi-codegen -generate types -package openapi -o configurator/backend/openapi/types-gen.go openapi/configurator.yaml
```