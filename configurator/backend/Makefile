# Go parameters
#GOBUILD_CMD=GOOS=linux GOARCH=amd64 go build
export PATH := $(shell go env GOPATH)/bin:$(PATH)

commit=`git rev-parse --short HEAD`
built_at=`date -u +%FT%T.000000Z`
tag=`git describe --tags`

all: clean assemble

assemble: backend
	mkdir -p ./build/dist/
	mv configurator ./build/dist/

backend:
	echo "Using path $(PATH)"
	go mod tidy
	go build -ldflags "-X main.commit=${commit} -X main.builtAt=${built_at} -X main.tag=${tag}" -o configurator

clean:
	rm -f configurator
	rm -rf ./build
