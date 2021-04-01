---
prop1: "Test"
---

import {CodeInTabs, CodeTab} from "../../../components/Code";
import {Hint, LargeLink} from "../../../components/documentationComponents";


# Authorization

**EventNative** supports two types of authorization: client/server secrets and admin token.

## Client/server secrets authorization

All incoming events should pass client/server secrets authorization depends on the endpoint type:

* `/api/v1/event` - client secret authorization;
* `/api/v1/s2s/event` - server secret authorization.

Secrets objects configuration has all fields **optional**:

| Field | Type | Description |
| :--- | :--- | :--- |
| **id** | string | Unique identifier of secrets object |
| **client\_secret** | string | Client token is used in client endpoint authorization |
| **server\_secret** | string | Server token is used in server endpoint authorization |
| **origins** | string array | An array of allowed request origins. Values can be with wildcard e.g. "abc\*" will allow requests from abc.com, abcd.com, etc. |

**EventNative** supports ****reloadable client/server secrets authorization configuration from an HTTP source, from a local file, and from YAML structure in app config.

##  YAML configuration

Authorization can be configured via YAML array of objects.

```yaml
server:
  auth:
   -
    id: unique_tokenId
    client_secret: bd33c5fa-d69f-11ea-87d0-0242ac130003
    server_secret: 5f15eba2-db58-11ea-87d0-0242ac130003
    origins:
      - '*abc.com'
      - 'efg.com'
   -
    id: unique_tokenId2
    client_secret: 123jsy213c5fa-c20765a0-d69f003
   -
    id: unique_tokenId3
    server_secret: 231dasds-3211kb3rdf-412dkjnabf
```

Also, authorization can be configured via plain string. In this case, plain string will be parsed as client secret.

```yaml
server:
  auth: 193b6281-f211-47a9-b384-102cf4cd2d55 #client secret
```

## HTTP URL

```yaml
server:
  auth: 'https://token-source.com/path'
  auth_reload_sec: 30
```
<Hint>
    Authorization will be reloaded every <b>auth_reload_sec</b> seconds. Default value is <b>30</b>.
</Hint>


HTTP requests are sent with `If-Modified-Since` header. If HTTP response returns 304 code authorization isn't reconfigured.
If authorization content was changed \(or logic isn't supported\) - HTTP response must return 200 code,
`Last-Modified` header, and body with the following structure:

```yaml
{
  "tokens": [ #array of json objects
    {
      "id": "uniq_id_1",
      "client_secret": "123dasbc",
      "server_secret": "abcc22",
      "origins": ["abc.com", "*.yourdomain.com"]
    }
  ]
}
```

## Local file

Tokens file must have the same payload as the HTTP response body above.

```yaml
server:
  auth: 'file:///home/eventnative/app/res/tokens.json'
  auth_reload_sec: 30
```

## Admin token authorization

<LargeLink href="/docs/other-features/admin-endpoints" title="Read more about administrative token auth" />
