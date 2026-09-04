# Bulker HTTP Interface

And HTTP interface on top of Bulker Go intefarce with [persistent configuration](https://github.com/jitsucom/bulker/blob/main/bulker/bulker.go) storage



## Configuration

The service should be started with a single `./bulker` command and all configuration should be done with environment variables. List of available config options:

#### `BULKER_HTTP_PORT`

(or just `PORT` for compatibility); default value `3042`

#### `BULKER_CONFIG_SOURCE`

Points bulker server to a configuration source. So far it should recognize only URL `postgres://user:password@host:port/db` which should be a connection to postgres. In future we add `redis://` (for redis based config), `file:/path/to/file` (for local files) 

#### `BULKER_CONFIG_POSTGRES_QUERY`

Relevant only for `postres://` config sources. Contains a query which pulls list of destinations. Example:

```
BULKER_CONFIG_POSTGRES_QUERY="select id as destination_id,config::TEXT as config from \"ConfigurationObject]" where deleted=false and type='destination'"
```

The result should contain two columns: destination_id and config

#### `AUTH_TOKENS` (and `BULKER_TOKEN_SECRET`)

Comma-separated a list of auth tokens. Token can have either of those formats:

* `${token}` un-encripted token value (token can't contain `.` or white space)
* `${salt}.${hex(sha512(token + salt + (process.env.BULKER_TOKEN_SECRET || ''))}` hashed token. `${salt}` should be random string
  * Example of hashing: `21a2ae36-32994870a9fbf2f61ea6f6c8`→ `bt6ghq4tpqr.WMMKlCNvcwpCkHFwFDLDaTGTuBT37yTioDFsMXRAXrY`
  * `BULKER_TOKEN_SECRET` can be a comma-separated list of secret. In this case hash should be checked against each secret.



## HTTP API

### Authorization

All requests should contain `Application: Bearer <token>` where token is unencrypted token

#### `POST /load/{destinationId}`

GET parameters should mirror [options](https://github.com/jitsucom/bulker/blob/main/implementations/sql/options.go) - `WithPartition` →  `partition`, `MergeRows` → `mergeRows`, etc

Body should be either one JSON object (for autocommit mode), or a stream of JSON objects for batch mode.


## Config storage

Bulker should make the best effort to be able to work without responsive configuration storage. For Postgres:

* During start, it should read all destinations config and keep them in RAM
* It should periodically reload configs from Postgres



