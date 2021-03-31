import {LargeLink} from "../../../components/documentationComponents";
import {Hint} from "../../../components/documentationComponents";

# Deployment

[**EventNative**](https://github.com/jitsucom/eventnative) — is an open-source core of Jitsu. It is a monolithic app
that takes care of all features, such as pulling data from external APIs and accepting event stream from
[JS SDK](/docs/sending-data/javascript-reference) or [API](/docs/sending-data/api).

EventNative is written in Go and compiles into a single binary. It has zero mandatory dependencies. However, certain external
services is required for certain features:

 * [etcd](https://etcd.io/) is required for coordination if EventNative works in a [cluster mode](/docs/other-features/scaling-eventnative)
 * [Redis](https://redis.io) is required for [retrospective user recognition](/docs/other-features/retrospective-user-recognition)



We support multiple methods of deployment with the easiest being [**Heroku 1-click deploy**](/docs/deployment/deploy-on-heroku).
However, for production usage we recommend [**Docker**](/docs/deployment/deploy-with-docker). Please see all available deployment methods:

<LargeLink title="Deploy on heroku" href="/docs/deployment/deploy-on-heroku" />

<LargeLink title="Deploy with Docker" href="/docs/deployment/deploy-with-docker" />

<LargeLink title="Build from Sources" href="/docs/deployment/build-from-sources" />

<Hint>
    <a href="https://github.com/jitsucom/eventnative">Read more about EventNative on GitHub</a>
</Hint>



