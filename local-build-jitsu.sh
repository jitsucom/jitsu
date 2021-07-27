TAG=local

echo "Building Server lib JS locally.."
rm -rf server/build && rm -rf javascript/dist && rm -rf server/web/dist && \
cd javascript-sdk/ && yarn clean && yarn install --prefer-offline && yarn build && cd ../server && \
make js_release && cd ../ || { echo 'Server build failed' ; exit 1; }
docker buildx build --platform linux/amd64 -t jitsucom/server:"$TAG" -f server-release.Dockerfile --build-arg dhid=jitsucom  . || { echo 'Server dockerx build failed' ; exit 1; }

echo "Building Configurator UI locally.."
rm -f configurator/backend/build/dist/configurator && rm -rf configurator/frontend/build && \
cd configurator/frontend/ && yarn clean && yarn install --prefer-offline && CI=false NODE_ENV=production ANALYTICS_KEYS='{"eventnative": "js.gpon6lmpwquappfl07tuq.ka5sxhsm08cmblny72tevi"}' yarn build && \
cd ../../ || { echo 'Configurator build failed' ; exit 1; }
docker buildx build --platform linux/amd64 -t jitsucom/configurator:"$TAG" --build-arg dhid=jitsucom -f configurator-release.Dockerfile . || { echo 'Configurator dockerx build failed' ; exit 1; }

cd docker
docker buildx build --platform linux/amd64 -t jitsucom/jitsu:latest -t jitsucom/jitsu:$TAG --build-arg dhid=jitsu --build-arg SRC_VERSION=$TAG . || { echo 'Jitsu dockerx build failed' ; exit 1; }
cd ../
