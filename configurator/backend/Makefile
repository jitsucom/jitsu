# Go parameters
export GOBUILD_PREFIX=
export PATH := $(shell go env GOPATH)/bin:$(PATH)
export DIST_DIR := ./build/dist/

commit=`git rev-parse --short HEAD`
built_at=`date -u +%FT%T.000000Z`
branch=$(shell git rev-parse --abbrev-ref HEAD)

tag = $$( \
    case $(branch) in \
        ( master ) git describe --tags ;; \
        ( * ) echo $(branch) ;; \
    esac )

all: clean assemble

docker_assemble: clean go_generate build_backend assemble_backend

assemble: backend assemble_backend

assemble_backend:
	mkdir -p $(DIST_DIR)
	mv configurator $(DIST_DIR)

backend: go_generate deps_backend build_backend

go_generate:
	go get github.com/deepmap/oapi-codegen/cmd/oapi-codegen@v1.10.1
	go generate

deps_backend:
	echo "Using path $(PATH)"
	go mod download

build_backend:
	$(GOBUILD_PREFIX) go build -ldflags "-X main.commit=${commit} -X main.builtAt=${built_at} -X main.tag=${tag}" -o configurator

test_backend:
	go test -failfast -v -parallel=1 ./...

clean:
	rm -f configurator
	rm -rf ./build