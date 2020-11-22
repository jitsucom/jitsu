# Go parameters
#GOBUILD_CMD=GOOS=linux GOARCH=amd64 go build
export PATH := $(shell go env GOPATH)/bin:$(PATH)

commit=`git rev-parse --short HEAD`
built_at=`date -u +%FT%T.000000Z`
tag=`git describe --tags`

all: clean assemble

assemble: backend js
	mkdir -p ./build/dist/web
	cp ./web/dist/web/* ./build/dist/web/
	cp ./web/welcome.html ./build/dist/web/
	cp eventnative ./build/dist/

backend:
	echo "Using path $(PATH)"
	go get -u github.com/mailru/easyjson/...
	go mod tidy
	go generate
	go build -ldflags "-X main.commit=${commit} -X main.builtAt=${built_at} -X main.tag=${tag}" -o eventnative

js:
	npm i --prefix ./web && npm run build --prefix ./web

test_backend:
	go test -failfast -v -parallel=1 ./...

clean:
	go clean
	rm -f $(APPLICATION)
	rm -rf ./web/build
	rm -rf ./build
