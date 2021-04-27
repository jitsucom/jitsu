# Go parameters
#GOBUILD_CMD=GOOS=linux GOARCH=amd64 go build
export PATH := $(shell go env GOPATH)/bin:$(PATH)

commit=`git rev-parse --short HEAD`
built_at=`date -u +%FT%T.000000Z`
tag=`git describe --tags`

all: clean assemble

docker_assemble: clean build_backend assemble_backend

assemble: backend assemble_backend

assemble_backend:
	mkdir -p ./build/dist/
	mv configurator ./build/dist/

backend: deps_backend build_backend

deps_backend:
	echo "Using path $(PATH)"
	go mod tidy

build_backend:
	go build -ldflags "-X main.commit=${commit} -X main.builtAt=${built_at} -X main.tag=${tag}" -o configurator

test_backend:
	go test -failfast -v -parallel=1 ./...

clean:
	rm -f configurator
	rm -rf ./build