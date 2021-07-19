GO_BUILD_PARAMS='GOOS=linux GOARCH=amd64'

if [ "$1" == 'arm' ]
then
  GO_BUILD_PARAMS='GOOS=linux GOARCH=arm64'
fi

cd javascript-sdk/ && yarn clean && yarn install && yarn build &&\
cd ../server && make all GOBUILD_PREFIX="$GO_BUILD_PARAMS" &&\
cd ../ && docker build -t jitsucom/server -t jitsucom/server:local -f server-local.Dockerfile --build-arg dhid=jitsucom .