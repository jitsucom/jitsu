import {CodeInTabs, CodeTab} from "../../../components/Code";
import {Hint, APIParam, APIMethod} from "../../../components/documentationComponents";

# Admin Endpoints


**EventNative** has a number system for diagnostics and provisioning (aka admin end-points). All those end-points
are secured with a configurable token:

```yaml
server:
  admin_token: your_admin_token
  
destinations:
...  
```

<Hint>
    Put admin token to HTTP requests in <code inline={true}>X-Admin-Token</code> header
</Hint>


See a list of all API endpoints below

<APIMethod method="POST" path="/api/v1/destinations/test" title="Destinations test connection"/>

This end-point tests if EventNative can connect to particular destination

<h4>Parameters</h4>

<APIParam name={"X-Auth-Token"} dataType="string" required={true} type="header">Authorization token (see below)</APIParam>

<h4>Request Payload and Response</h4>

Request payload should follow the same structure as [EventNative destination configuration](/docs/destinations-configuration).
Example for postgres

```yaml
{
  "type": "postgres",
  "datasource": {
    "host": "my_postgres_host",
    "db": "my-db",
    "schema": "myschema",
    "port": 5432,
    "username": "user",
    "password": "pass",
    "parameters": {}
  }
}
```

Response will be either HTTP 200 OK, or error with description as JSON

<APIMethod method="GET" path="/api/v1/cluster"/>

This api call returns a cluster information as JSON. If synchronization service is configured, this endpoint returns all instances in the cluster,
otherwise only **server.name** from the configuration.
{% endapi-method-description %}

<h4>Parameters</h4>

<APIParam name={"X-Auth-Token"} dataType="string" required={true} type="header" description="Authorization token (see above)"/>

<h4>Response</h4>

Response body contains instance names (from **server.name** configuration section). Example:

```yaml
{
  "instances": [
    {
      "name": "instance1.domain.com"
    },
    {
      "name": "instance2.domain.com"
    }
  ]
}
```

<APIMethod method="GET" path="/api/v1/fallback?destination_ids=id1,id2"/>

Get all fallback files per destination(s). Fallback files contains all JSON events that
haven't been written to a destination due to error. Each line of this file is a JSON object
with original JSON event and error description

<APIParam name={"X-Auth-Token"} dataType="string" required={true} type="header" description="Authorization token (see above)"/>
<APIParam name="destination_id" dataType="string" required={true} type="queryString" description="comma-separated array of destination ids strings"/>

<h4>Response</h4>

```yaml
{
  "files": [
    {
      "file_name": "host-errors-destination1-2020-11-25T09-57-10.411.log",
      "destination_id": "destination1",
      "uploaded": false,
      // error - replaying error 
      "error": "Error uploading host-errors-destination1-2020-11-25T09-57-10.411.log wrong format"
    }
}
```

<APIMethod method="POST" path="/api/v1/replay"/>

This method replays data from the file. File should be locally located on a same
machine as server instance.

<APIParam name={"X-Auth-Token"} dataType="string" required={true} type="header" description="Authorization token (see above)"/>

<APIParam name={"file_format"} dataType="string" required={false} type="jsonBody" description="File format">
    For storing custom JSON files via fallback endpoint use this parameter with value = raw_json. Each JSON must be on a single
    line and has \n in the end. The last row in the file must be empty. Omit this parameter if you are storing a fallback file.
</APIParam>

<APIParam name={"destination_id"} dataType="string" required={false} type="jsonBody" description="Destination to load data. By default, it is taken from fallback file name."/>

<APIParam name={"file_name"} dataType="string" required={true} type="jsonBody" description="name of a fallback file to replay or global path to a custom file with json data"/>

<h4>Request and response</h4>

Request example

```yaml
{
  "file_name": "hostname-destination1-2020-11-25T09-57-10.411.log"
}
```

Response will be either HTTP 200 OK, or error with description as JSON

