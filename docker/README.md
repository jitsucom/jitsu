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

#### `SEED_USER_EMAIL`, `SEED_USER_PASSWORD`

**Required**

Initial user login and password. 

The very first user will be created with those credentials, and it will become an admin user. 

**Please change the password right after first login.**

#### `JITSU_PUBLIC_URL`

**Default value:** `http://localhost:${JITSU_UI_PORT}/`

This is a URL where Jitsu UI will be available.

When UI is deployed on remote server, set it with your remote server URL, e.g.: http://your-domain:3000.

For production deployments, it is recommended to put it behind an HTTPs load balancer or reverse proxy.

In this case, this value must be set to a public URL, such as: https://jitsu.my-company.com.

#### `JITSU_INGEST_PUBLIC_URL`

**Default value:** `http://localhost:${JITSU_INGEST_PORT}/`

This is a URL where Jitsu Ingest will be available. 

When Jitsu is deployed on remote server, set it with your remote server URL, e.g.: http://your-domain:8080.

For production deployments, it is recommended to put it behind an HTTPs load balancer or reverse proxy.

In this case, this value must be set to a public URL, such as: https://jitsu.my-company.com.

#### `CONSOLE_TOKEN`, `POSTGRES_PASSWORD`, `BULKER_TOKEN`, `SYNCCTL_TOKEN`

Those secrets are used mostly for internal communication between Jitsu components.

Please make sure to generate random values for those variables, and keep `raw:` prefix for those variables


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