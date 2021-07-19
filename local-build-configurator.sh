GO_BUILD_PARAMS='GOOS=linux GOARCH=amd64'

if [ "$1" == 'arm' ]
then
  GO_BUILD_PARAMS='GOOS=linux GOARCH=arm64'
fi

cd configurator/backend && rm -rf build && make all GOBUILD_PREFIX="$GO_BUILD_PARAMS" &&\
cd ../frontend/ && rm -rf build && yarn clean && yarn install && CI=false NODE_ENV=production ANALYTICS_KEYS='{"eventnative": "js.gpon6lmpwquappfl07tuq.ka5sxhsm08cmblny72tevi"}' yarn build &&\
cd ../../ &&\
docker build -t jitsucom/configurator -t jitsucom/configurator:local -f configurator-local.Dockerfile --build-arg dhid=jitsucom .