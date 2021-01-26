# BASE STAGE
FROM golang:1.14.6-alpine3.12 as main

ENV EVENTNATIVE_USER=eventnative

RUN addgroup -S $EVENTNATIVE_USER \
    && adduser -S -G $EVENTNATIVE_USER $EVENTNATIVE_USER \
    && mkdir -p /home/$EVENTNATIVE_USER/logs/events \
    && mkdir -p /home/$EVENTNATIVE_USER/app/res \
    && chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/$EVENTNATIVE_USER

#######################################
# BUILD STAGE
FROM main as builder

# Install dependencies
RUN apk add git make bash npm

# Copy project
ADD . /go/src/github.com/jitsucom/eventnative

RUN chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /go/src/github.com/jitsucom/eventnative

# Build
WORKDIR /go/src/github.com/jitsucom/eventnative
USER $EVENTNATIVE_USER
RUN make

# Copy static files
RUN cp -r ./build/dist/* /home/$EVENTNATIVE_USER/app/

#######################################
# FINAL STAGE
FROM main as final

ENV TZ=UTC

RUN apk add --no-cache build-base python3 py3-pip python3-dev tzdata
RUN pip install --upgrade pip

USER $EVENTNATIVE_USER
WORKDIR /home/$EVENTNATIVE_USER/app

# copy static files from build-image
COPY --from=builder /home/$EVENTNATIVE_USER/app .

VOLUME ["/home/$EVENTNATIVE_USER/app/res", "/home/$EVENTNATIVE_USER/logs/events"]
EXPOSE 8001

ENTRYPOINT ["./eventnative", "-cfg=./res/eventnative.yaml", "-cr=true"]
