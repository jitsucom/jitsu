FROM golang:1.14.6-alpine3.12

ENV EVENTNATIVE_USER=eventnative

# Install dependencies
RUN echo "@testing http://nl.alpinelinux.org/alpine/edge/testing" >> /etc/apk/repositories
RUN apk add git make npm shadow@testing

# Copy project
ADD . /go/src/github.com/ksensehq/eventnative

# Create eventnative group & user & dirs
RUN groupadd -r $EVENTNATIVE_USER \
    && useradd -r -d /home/$EVENTNATIVE_USER -g $EVENTNATIVE_USER $EVENTNATIVE_USER \
    && mkdir /home/$EVENTNATIVE_USER \
    && mkdir -p /home/$EVENTNATIVE_USER/logs/events \
    && mkdir -p /home/$EVENTNATIVE_USER/app/res \
    && chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /home/$EVENTNATIVE_USER \
    && chown -R $EVENTNATIVE_USER:$EVENTNATIVE_USER /go/src/github.com/ksensehq/eventnative

# Build
USER $EVENTNATIVE_USER
WORKDIR /go/src/github.com/ksensehq/eventnative
RUN make

# Copy static files
RUN cp -r /go/src/github.com/ksensehq/eventnative/build/dist/* /home/$EVENTNATIVE_USER/app/

# Delete go files
USER root
RUN rm -rf /go/ \
    && rm -rf /usr/local/go

USER $EVENTNATIVE_USER
WORKDIR /home/$EVENTNATIVE_USER/app

EXPOSE 8001

ENTRYPOINT /home/$EVENTNATIVE_USER/app/$EVENTNATIVE_USER -cfg=/home/$EVENTNATIVE_USER/app/res/eventnative.yaml