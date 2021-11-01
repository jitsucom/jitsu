# Go parameters
export GOBUILD_PREFIX=
export PATH := $(shell go env GOPATH)/bin:$(PATH)
export APPLICATION := eventnative
export LIB_JS := ../javascript-sdk/dist/web/lib.js
commit=`git rev-parse --short HEAD`
built_at=`date -u +%FT%T.000000Z`
branch=$(shell git branch --show-current)

tag = $$( \
    case $(branch) in \
        ( master ) git describe --tags ;; \
        ( * ) echo $(branch) ;; \
    esac )

all: clean assemble

js_release: js assemble_js copy_new_jitsu_sdk

docker_assemble: clean build_backend assemble_backend

assemble: backend assemble_backend js copy_new_jitsu_sdk assemble_js

assemble_backend:
	mkdir -p ./build/dist/web
	mv $(APPLICATION) ./build/dist/

assemble_js:
	mkdir -p ./build/dist/web
	cp ./web/dist/web/* ./build/dist/web/
	cp ./web/welcome.html ./build/dist/web/

copy_new_jitsu_sdk:
	test -e $(LIB_JS) && cp $(LIB_JS) ./build/dist/web/ || echo "\n\033[31m!!! WARNING:\033[m lib.js wasn't found at $(LIB_JS). Please build JS SDK first, or embedded tracking will not work!\n"

js:
	npm i --prefix ./web && npm run build --prefix ./web

backend: deps_backend build_backend

deps_backend:
	echo "Using path $(PATH)"
	go mod tidy

build_backend:
	$(GOBUILD_PREFIX) go build -ldflags "-X main.commit=${commit} -X main.builtAt=${built_at} -X main.tag=${tag}" -o $(APPLICATION)

test_backend:
	go test -failfast -v -parallel=1 ./...

clean: clean_js clean_backend
	rm -rf build/dist

clean_js:
	rm -rf ./web/build

clean_backend:
	rm -f $(APPLICATION)
	rm -rf ./build/dist/$(APPLICATION)