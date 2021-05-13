cd configurator/backend && make all GOBUILD_PREFIX='GOOS=linux GOARCH=amd64'
cd ../frontend/ && yarn clean && yarn install && CI=false NODE_ENV=production ANALYTICS_KEYS='{"eventnative": "js.gpon6lmpwquappfl07tuq.ka5sxhsm08cmblny72tevi"}' yarn build
cd ../../
docker build -t jitsucom/configurator -f configurator-local.Dockerfile .