# Go parameters
#GOBUILD_CMD=GOOS=linux GOARCH=amd64 go build
export PATH := $(shell go env GOPATH)/bin:$(PATH)

all: clean assemble

assemble: backend js
	mkdir -p ./build/dist/web
	cp ./web/build/* ./build/dist/web/
	cp ./web/welcome.html ./build/dist/web/
	cp eventnative ./build/dist/

backend:
	echo "Using path $(PATH)"
	# this is a temporary script until etcd releases 3.3 version that fixes bug with deprecated grpc functionality usage
	go get google.golang.org/grpc@v1.26.0
	go get -u github.com/mailru/easyjson/...
	go mod tidy
	go generate
	go build -o eventnative

js:
	npm i --prefix ./web && npm run build --prefix ./web

test_backend:
	go test -failfast -v -parallel=1 ./...

clean:
	go clean
	rm -f $(APPLICATION)
	rm -rf ./web/build
	rm -rf ./build
