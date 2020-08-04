FROM golang:1.14.6-alpine3.12 AS build

ENV TRACKER_USER=tracker

# Install dependencies
RUN echo "@testing http://nl.alpinelinux.org/alpine/edge/testing" >> /etc/apk/repositories
RUN apk add git
RUN apk -U add shadow@testing

# Create tracker group & user
RUN groupadd -r $TRACKER_USER \
    && useradd -r -d /home/$TRACKER_USER -g $TRACKER_USER $TRACKER_USER \
    && mkdir /home/$TRACKER_USER \
    && chown $TRACKER_USER:$TRACKER_USER /home/$TRACKER_USER

# Install easyjson
RUN go get -u github.com/mailru/easyjson/...
RUN chown -R $TRACKER_USER:$TRACKER_USER /go/pkg

# Copy project
ADD . /go/src/github.com/ksenseai/tracker
WORKDIR /go/src/github.com/ksenseai/tracker
RUN chown -R $TRACKER_USER:$TRACKER_USER /go/src/github.com/ksenseai/tracker

#load dependencies and generate meta
USER $TRACKER_USER
RUN go mod tidy
RUN go generate

# Create dirs
RUN mkdir -p /home/$TRACKER_USER/logs/events \
    && mkdir -p /home/$TRACKER_USER/app/res \
    && mkdir -p /home/$TRACKER_USER/app/static/prod

# Copy static files
RUN cp /go/src/github.com/ksenseai/tracker/web/inline.js /home/$TRACKER_USER/app/static/prod/
RUN cp /go/src/github.com/ksenseai/tracker/web/track.js /home/$TRACKER_USER/app/static/prod/

# Build project
RUN GOOS=linux GOARCH=amd64 go build -o /home/$TRACKER_USER/app/tracker

WORKDIR /home/$TRACKER_USER/app

EXPOSE 8001

ENTRYPOINT /home/$TRACKER_USER/app/$TRACKER_USER -config_path=/home/$TRACKER_USER/app/res