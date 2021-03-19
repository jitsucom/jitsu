# BASE STAGE
FROM golang:1.14.6-alpine3.12 as main

RUN apk add --no-cache build-base python3 py3-pip python3-dev tzdata
RUN pip install --upgrade pip

ENV EVENTNATIVE_USER=eventnative

RUN addgroup -S $EVENTNATIVE_USER \
    && adduser -S -G $EVENTNATIVE_USER $EVENTNATIVE_USER \
    && mkdir -p /home/$EVENTNATIVE_USER/logs/events \
    && mkdir -p /home/$EVENTNATIVE_USER/app/res \
    && chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/$EVENTNATIVE_USER

#######################################
# BUILD JS STAGE
FROM main as jsbuilder

# Install dependencies
RUN apk add git make bash npm

# Copy js
ADD web /go/src/github.com/jitsucom/eventnative/web
ADD Makefile /go/src/github.com/jitsucom/eventnative/Makefile

RUN chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /go/src/github.com/jitsucom/eventnative
WORKDIR /go/src/github.com/jitsucom/eventnative
USER $EVENTNATIVE_USER

# Build js (for caching) and copy builded files
RUN make clean_js assemble_js &&\
    cp -r ./build/dist/* /home/$EVENTNATIVE_USER/app/

#######################################
# BUILD BACKEND STAGE
FROM main as builder

# Install dependencies
RUN apk add git make bash

#Copy backend
ADD . /go/src/github.com/jitsucom/eventnative

RUN chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /go/src/github.com/jitsucom/eventnative
WORKDIR /go/src/github.com/jitsucom/eventnative
USER $EVENTNATIVE_USER

# Build backend and copy builded files
RUN make clean_backend assemble_backend &&\
    cp -r ./build/dist/* /home/$EVENTNATIVE_USER/app/

#######################################
# FINAL STAGE
FROM main as final

ENV TZ=UTC

USER $EVENTNATIVE_USER
WORKDIR /home/$EVENTNATIVE_USER/app

# copy static files from build-image
COPY --from=builder /home/$EVENTNATIVE_USER/app .
COPY --from=jsbuilder /home/$EVENTNATIVE_USER/app .

VOLUME ["/home/$EVENTNATIVE_USER/app/res", "/home/$EVENTNATIVE_USER/logs/events"]
EXPOSE 8001

ENTRYPOINT ["./eventnative", "-cfg=./res/eventnative.yaml", "-cr=true"]
