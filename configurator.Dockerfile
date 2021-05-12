# BASE STAGE
FROM alpine:3.13 as main

ENV CONFIGURATOR_USER=configurator

RUN addgroup -S $CONFIGURATOR_USER \
    && adduser -S -G $CONFIGURATOR_USER $CONFIGURATOR_USER \
    && mkdir -p /home/$CONFIGURATOR_USER/data/logs \
    && mkdir -p /home/$CONFIGURATOR_USER/data/config \
    && mkdir -p /home/$CONFIGURATOR_USER/app/web \
    && chown -R $CONFIGURATOR_USER:$CONFIGURATOR_USER /home/$CONFIGURATOR_USER

# Create symlink for backward compatibility
RUN ln -s /home/$CONFIGURATOR_USER/data/config /home/$CONFIGURATOR_USER/app/res && \
    ln -s /home/$CONFIGURATOR_USER/data/logs /home/$CONFIGURATOR_USER/logs && \
    chown -R $CONFIGURATOR_USER:$CONFIGURATOR_USER /home/$CONFIGURATOR_USER/logs
#######################################
# BUILD JS STAGE
FROM jitsucom/configurator-builder as jsbuilder

# Install yarn dependencies
ADD configurator/frontend/package.json /frontend/package.json

ARG SKIP_UI_BUILD
ENV SKIP_UI=$SKIP_UI_BUILD

WORKDIR /frontend

# We need to make sure empty 'build' directory exists if SKIP_UI_BUILD==true and yarn won't make it
RUN mkdir build

RUN if [ "$SKIP_UI" != "true" ]; then yarn install --prefer-offline --frozen-lockfile --network-timeout 1000000; fi

# Copy project
ADD configurator/frontend/. ./

# write the output of the date command into a file called tmp_variable
RUN free | awk 'FNR == 2 {print $2}' > ./build/mem

# Check RAM > 4gb else error (JS build requires >4gb RAM)
RUN if [ $(cat ./build/mem) < "4000000" ]; then echo echo Docker build requires 4gb of RAM. Configure it in the machine Docker configuration && exit 1; else rm ./build/mem; fi

# Build
RUN if [ "$SKIP_UI" != "true" ]; then CI=false NODE_ENV=production ANALYTICS_KEYS='{\"eventnative\": \"js.gpon6lmpwquappfl07tuq.ka5sxhsm08cmblny72tevi\"}' yarn build; fi

#######################################
# BUILD BACKEND STAGE
FROM jitsucom/configurator-builder as builder

ENV CONFIGURATOR_USER=configurator

RUN mkdir -p /go/src/github.com/jitsucom/jitsu/$CONFIGURATOR_USER/backend && \
    mkdir -p /go/src/github.com/jitsucom/jitsu/server

WORKDIR /go/src/github.com/jitsucom/jitsu/$CONFIGURATOR_USER/backend

#Caching dependencies
ADD configurator/backend/go.mod configurator/backend/go.sum ./
ADD server/go.mod server/go.sum /go/src/github.com/jitsucom/jitsu/server/
RUN go mod download

#Copy backend
ADD configurator/backend/. ./.
ADD server /go/src/github.com/jitsucom/jitsu/server
ADD .git /go/src/github.com/jitsucom/jitsu/.git

# Build
RUN make docker_assemble

#######################################
# FINAL STAGE
FROM main as final

ENV TZ=UTC

# copy static files from build-image
COPY --from=builder /go/src/github.com/jitsucom/jitsu/$CONFIGURATOR_USER/backend/build/dist /home/$CONFIGURATOR_USER/app

COPY --from=jsbuilder /frontend/build /home/$CONFIGURATOR_USER/app/web

RUN chown -R $CONFIGURATOR_USER:$CONFIGURATOR_USER /home/$CONFIGURATOR_USER/app

USER $CONFIGURATOR_USER
WORKDIR /home/$CONFIGURATOR_USER/app

VOLUME ["/home/$CONFIGURATOR_USER/data"]
EXPOSE 7000

ENTRYPOINT ["./configurator", "-cfg=../data/config/configurator.yaml", "-cr=true"]