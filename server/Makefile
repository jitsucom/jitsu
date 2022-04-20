# Go parameters
export GOBUILD_PREFIX=
export PATH := $(shell go env GOPATH)/bin:$(PATH)
export APPLICATION := eventnative
export LIB_JS := ../javascript-sdk/lib.js
export DIST_DIR := ./build/dist
export DIST_WEB_DIR := $(DIST_DIR)/web/
commit=`git rev-parse --short HEAD`
built_at=`date -u +%FT%T.000000Z`
branch=$(shell git rev-parse --abbrev-ref HEAD)

tag = $$( \
    case $(branch) in \
        ( master ) git describe --tags ;; \
        ( * ) echo $(branch) ;; \
    esac )

all: clean assemble

js_release: assemble_js copy_new_jitsu_sdk

docker_assemble: clean build_backend assemble_backend

assemble: backend assemble_backend copy_new_jitsu_sdk assemble_js

assemble_backend:
	mkdir -p $(DIST_WEB_DIR)
	mv $(APPLICATION) $(DIST_DIR)

assemble_js:
	mkdir -p $(DIST_WEB_DIR)
	cp ./web/dist/web/* $(DIST_WEB_DIR)
	cp ./web/welcome.html $(DIST_WEB_DIR)

copy_new_jitsu_sdk:
	mkdir -p $(DIST_WEB_DIR)
	test -e $(LIB_JS) && cp $(LIB_JS) $(DIST_WEB_DIR) || echo "\n\033[31m!!! WARNING:\033[m lib.js wasn't found at $(LIB_JS). Please build JS SDK first, or embedded tracking will not work!\n"

backend: deps_backend build_backend

deps_backend:
	echo "Using path $(PATH)"
	go mod download

build_backend:
	$(GOBUILD_PREFIX) go build -ldflags "-X main.commit=${commit} -X main.builtAt=${built_at} -X main.tag=${tag}" -o $(APPLICATION)

test_backend:
	go test -failfast -v -parallel=1 ./...

clean: clean_backend
	rm -rf $(DIST_DIR)

clean_backend:
	rm -f $(APPLICATION)
	rm -rf $(DIST_DIR)/$(APPLICATION)