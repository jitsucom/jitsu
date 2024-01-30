# Quick Start

This guide uses docker compose to run Jitsu locally. It's suitable for testing purposes only.

## Requirements

* [Docker Engine](https://docs.docker.com/engine/install/) >= 19.03.0
* Kubernetes cluster (Optional. Required for connectors syncs)

## Configuration

1. You'll need to create a `.env` file in `docker` directory. You can copy `.env.example` to `.env`:

```shell
# Copy .env.example to .env
cp .env.example .env
```

2. Set up all required variables in `.env` file.

#### `ADMIN_CREDENTIALS`

**Required**

Comma-separated list of admin user credentials in format email:password, e.g.: email1@example.com:password1,email2@example.com:password2

#### `JITSU_PUBLIC_URL`

This is an URL where Jitsu UI will be available.

When using jitsu locally, no need to set this variable.

**Default value:** `http://localhost:${JITSU_UI_PORT}/`

When UI is deployed on remote server, set it with your remote server URL, e.g.: `https://jitsu.mycompany.com:3000`.

#### `INGEST_DOMAIN`

Domain of the Jitsu Ingest API how it is available for external users. Ingest API is used for sending events to Jitsu.

When using jitsu locally, no need to set this variable.

**Default value:** `localhost`

When deployed on remote server, set it with your remote server domain, e.g.: `data.mycompany.com`.


## Run Jitsu

In `jitsu/docker` directory run:
```shell
docker-compose up
```

Open Jitsu UI url (e.g.: `http://localhost:3000/`) in your browser, login with any GitHub account and follow the instructions.

## Sending events

Create a new site in Jitsu UI and click `Setup instructions` button in the site context menu.

See [HTTP API](https://docs.jitsu.com/sending-data/) guide for details.


## Further steps

Those steps are optional, but they might make sense for you:

* Set up **Connectors Syncs**. See SYNCS_README.md for details
* Set `DISABLE_SIGNUP` in `.env` to `true` if you don't want to allow users to sign up
* See reference for other variables in [Production Deployment](https://docs.jitsu.com/self-hosting/configuration) guide.