import { CodeBlock } from "../CodeBlock/CodeBlock";

export const HTTPManual: React.FC<{ domain: string; writeKey?: string }> = ({ domain, writeKey }) => {
  return (
    <div className="py-8 px-6 flex justify-center">
      <div className="prose max-w-6xl w-full">
        <h1>HTTP API</h1>
        <p>
          You can use server to server API to send data to Jitsu. This is useful if you want to send data from your
          backend.
        </p>
        <p>In case of using HTTP API you may need to manually ad user's IP address and User Agent to the event.</p>
        <h2>Ingest endpoint</h2>
        <p>This endpoint can be used to send events to Jitsu:</p>
        <code>{`${domain}/api/s/s2s/{event-type}`}</code>
        <p>Event type could be:</p>
        <ul>
          <li>
            <code>page</code>, <code>track</code>, <code>identify</code> or <code>group</code>
          </li>
          <li>
            Use <code>event</code> as <code>event_type</code> if you want server to take actual event type from{" "}
            <code>type</code> field of the event payload
          </li>
        </ul>
        <p>
          The endpoint accepts POST requests with events payload in JSON format. Pay attention to <code>s2s</code> part
          of the URL.
          <br />
          The presence of this part indicates that the event is sent from server-to-server. Unlike browser events, s2s
          events are processed differently:
        </p>
        <ul>
          <li>
            Presence of <code>X-Write-Key</code> is mandatory, and the header should contain server write key of the
            site
          </li>
          <li>
            <code>context.ip</code> and <code>context.userAgent</code> are not extracted from the request headers, but
            should be passed explicitly in the event payload
          </li>
          <li>
            If <code>context.ip</code> is not present, the ip field will be empty to avoid confusion; same applies for{" "}
            <code>context.userAgent</code>
          </li>
        </ul>
        <h2>Examples</h2>
        <p>
          Send <code>track</code> event:
        </p>
        <CodeBlock lang="bash">{`curl --location '${domain}/api/s/s2s/track' \\
--header 'Content-Type: application/json' \\
--header 'X-Write-Key: ${writeKey}' \\
--data-raw '{
  "type": "track",
  "event": "testEvent",
  "properties": {
    "testProp": "test event properties"
  },
  "userId": "user@example.com",
  "anonymousId": "bKTtbVZw3yiqCJvCSJgjVeXp",
  "timestamp": "2023-04-12T13:29:04.690Z",
  "sentAt": "2023-04-12T13:29:04.690Z",
  "messageId": "voV6fulcZR4CTVnN89AnxFnC",
  "context": {
    "library": {
      "name": "jitsu-js",
      "version": "1.0.0"
    },
    "ip": "127.0.0.1",
    "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/111.0",
    "locale": "en-US",
    "screen": {
      "width": 2304,
      "height": 1296,
      "innerWidth": 1458,
      "innerHeight": 1186,
      "density": 2
    },
    "traits": {
      "email": "user@example.com"
    },
    "page": {
      "path": "/",
      "referrer": "",
      "referring_domain": "",
      "host": "example.com",
      "search": "",
      "title": "Example page event",
      "url": "https://example.com/",
      "enconding": "UTF-8"
    },
    "campaign": {
      "name": "example",
      "source": "g"
    }
  },
  "receivedAt": "2023-04-12T13:29:04.690Z"
}'`}</CodeBlock>
      </div>
    </div>
  );
};
