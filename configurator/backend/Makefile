# Go parameters
export GOBUILD_PREFIX=
export PATH := $(shell go env GOPATH)/bin:$(PATH)
export DIST_DIR := ./build/dist/

commit=`git rev-parse --short HEAD`
built_at=`date -u +%FT%T.000000Z`
branch=$(shell git branch --show-current)

tag = $$( \
    case $(branch) in \
        ( master ) git describe --tags ;; \
        ( * ) echo $(branch) ;; \
    esac )

all: clean assemble

docker_assemble: clean build_backend assemble_backend

assemble: backend assemble_backend

assemble_backend:
	mkdir -p $(DIST_DIR)
	mv configurator $(DIST_DIR)

backend: deps_backend build_backend

deps_backend:
	echo "Using path $(PATH)"
	go mod tidy

build_backend:
	$(GOBUILD_PREFIX) go build -ldflags "-X main.commit=${commit} -X main.builtAt=${built_at} -X main.tag=${tag}" -o configurator

test_backend:
	go test -failfast -v -parallel=1 ./...

clean:
	rm -f configurator
	rm -rf ./build