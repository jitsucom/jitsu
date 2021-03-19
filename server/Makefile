# Go parameters
#GOBUILD_CMD=GOOS=linux GOARCH=amd64 go build
export PATH := $(shell go env GOPATH)/bin:$(PATH)
export APPLICATION := eventnative

commit=`git rev-parse --short HEAD`
built_at=`date -u +%FT%T.000000Z`
tag=`git describe --tags`

all: clean assemble

assemble: backend js assemble_backend assemble_js

assemble_backend: backend
	mkdir -p ./build/dist/web
	mv $(APPLICATION) ./build/dist/

assemble_js: js
	mkdir -p ./build/dist/web
	cp ./web/dist/web/* ./build/dist/web/
	cp ./web/welcome.html ./build/dist/web/

backend:
	echo "Using path $(PATH)"
	go mod tidy
	go build -ldflags "-X main.commit=${commit} -X main.builtAt=${built_at} -X main.tag=${tag}" -o $(APPLICATION)

js:
	npm i --prefix ./web && npm run build --prefix ./web

test_backend:
	go test -failfast -v -parallel=1 ./...

clean: clean_js clean_backend
	rm -rf build/dist

clean_js:
	rm -rf ./web/build

clean_backend:
	rm -f $(APPLICATION)
	rm -rf ./build/dist/$(APPLICATION)