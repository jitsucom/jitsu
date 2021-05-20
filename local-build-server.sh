cd javascript-sdk/ && yarn clean && yarn install && yarn build &&\
cd ../server && make all GOBUILD_PREFIX='GOOS=linux GOARCH=amd64' &&\
cd ../ && docker build -t jitsucom/server -f server-local.Dockerfile --build-arg dhid=jitsucom .