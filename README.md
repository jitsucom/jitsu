<p align="center">
<img src="https://github.com/jitsucom/jitsu/blob/newjitsu/.readme-assets/github-hero-light-mode.png?raw=true#gh-light-mode-only" />
<img src="https://github.com/jitsucom/jitsu/blob/newjitsu/.readme-assets/github-hero-dark-mode.png?raw=true#gh-dark-mode-only" />
</p>

<p align="center">
<b>Open-source event data platform. An alternative to Segment.</b>
</p>

<p align="center">
<a href="https://jitsu.com">Website</a> ·
<a href="https://jitsu.com/docs">Docs</a> ·
<a href="https://jitsu.com/docs/mcp">MCP Server</a> ·
<a href="https://use.jitsu.com">Jitsu Cloud</a> ·
<a href="https://jitsu.com/docs/self-hosting">Self-hosting</a> ·
<a href="https://jitsu.com/slack">Slack</a> ·
<a href="https://github.com/jitsucom/jitsu/blob/newjitsu/LICENSE">MIT License</a>
</p>

<p align="center">
<a href="https://news.ycombinator.com/item?id=29106082">
  <img
    style="width: 200px; height: 43px;" width="200" height="43"
    alt="Featured on Hacker News"
    src="https://hackernews-badge.vercel.app/api?id=29106082"
  />
</a>
<a href="https://www.producthunt.com/posts/jitsu-2?utm_source=badge-featured&utm_medium=badge&utm_souce=badge-jitsu&#0045;2" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=297526&theme=neutral" alt="Jitsu - Open&#0045;source&#0032;real&#0045;time&#0032;data&#0032;collection&#0032;platform | Product Hunt" style="width: 200px; height: 43px;" width="200" height="43" /></a>
</p>

---

## What is Jitsu?

Jitsu collects event data from your websites, apps and servers, and delivers it to your data
warehouse and to whatever other tools you use. It covers the same ground as Segment, but it's
MIT-licensed and self-hostable, so the whole pipeline can run inside your own infrastructure —
or on [Jitsu Cloud](https://use.jitsu.com), same software, hosted.

Data lands in minutes, not hours: Segment loads warehouses once or twice a day (hourly at best),
while Jitsu delivers per destination in batches as frequent as a minute, or row-by-row where that
suits the destination. And where Segment bills by Monthly Tracked User, Jitsu Cloud bills by event
volume, so the bill tracks data rather than audience size — while self-hosting has no usage billing
at all.

A typical Jitsu setup gives you:

- **Event collection** from the browser, mobile, or the server, via
  [SDKs, an HTTP API, or a drop-in Segment proxy](https://jitsu.com/docs/sending-data).
- **Delivery to destinations** — ClickHouse, BigQuery, Snowflake, Redshift, Postgres, S3, GCS, and
  dozens of SaaS tools, streamed or micro-batched depending on what the destination prefers. See the
  [destination catalog](https://jitsu.com/docs/destinations/catalog).
- **[Functions](https://jitsu.com/docs/functions)** — JavaScript that runs on every event to filter,
  transform, and enrich it before delivery.
  - Write them in the browser, or build and deploy them from your own repo with the
    [Jitsu CLI](https://jitsu.com/docs/jitsu-cli) — `jitsu-cli init` scaffolds a TypeScript project
    with tests, and `jitsu-cli deploy` ships it to your workspace. Use whatever tooling you like:
    TypeScript, npm libraries, your own test suite, and your normal CI.
- **Connector syncs** — pull data *into* your warehouse from third-party sources (Airbyte-compatible
  connectors).
- **A user identity graph and profile builder**, built automatically from the event stream.
- **[Live Events](https://jitsu.com/docs/features/live-events)** — see every event, function log and
  destination write as it happens, which makes debugging a pipeline a matter of seconds rather than
  days.
- **An [MCP server](https://jitsu.com/docs/mcp)**, so an AI agent can configure and operate all of
  the above.

<p align="center">
<img src="https://github.com/jitsucom/jitsu/blob/newjitsu/.readme-assets/overview-screenshot.png?raw=true">
</p>

## Get started with Jitsu Cloud

The fastest way to run Jitsu is **[Jitsu Cloud](https://use.jitsu.com)** — we host and scale it for
you.

- **Free tier: 200k events/month**, no credit card required.
- Unlimited destinations and unlimited captured events on every plan.
- A **free ClickHouse instance** is included, so you can go from zero to queryable event data
  without provisioning a warehouse first.
- Custom domains, events debugger, and the Configuration API on the free tier too.

See [pricing](https://jitsu.com/pricing) for the full breakdown, or jump straight into the
[Quick Start guide](https://jitsu.com/docs).

Once you have a workspace:

1. **Create a site** (a stream) and grab your write key.
2. **Add a destination** — ClickHouse, BigQuery, Snowflake, Postgres, S3, or anything from the
   [catalog](https://jitsu.com/docs/destinations/catalog).
3. **Start sending events** using one of the methods below.

### Sending events

| Method                                                                  | Use it for                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------- |
| [HTML snippet](https://jitsu.com/docs/sending-data/html)                | Any website, no build step                        |
| [`@jitsu/js`](https://jitsu.com/docs/sending-data/npm)                  | Isomorphic — works in the browser and in Node.js  |
| [`@jitsu/jitsu-react`](https://jitsu.com/docs/sending-data/react)       | React and Next.js apps                            |
| [HTTP API](https://jitsu.com/docs/sending-data/http)                    | Any language, backend services                    |
| [Segment proxy](https://jitsu.com/docs/sending-data/segment-proxy)      | Migrating off Segment without touching client code |

Everything the UI does is also available through the
[Management API](https://jitsu.com/docs/management-api) and the
[Jitsu CLI](https://jitsu.com/docs/jitsu-cli).

## Jitsu MCP Server

Jitsu ships a [Model Context Protocol](https://modelcontextprotocol.io) server, so coding agents and
AI assistants can build and operate your data pipelines directly — no clicking through the UI.

An agent connected to Jitsu can set up a destination, wire a connection, send a test event, read the
resulting Live Events, notice that a function threw, fix the function, and re-run it — the full
loop, without a human in the middle.

**Endpoint:** `https://use.jitsu.com/mcp` (or `<your-console-url>/mcp` when self-hosting).

### Connect your client

**Claude Code**

```bash
claude mcp add --transport http jitsu https://use.jitsu.com/mcp
```

Other clients (Claude Desktop, Cursor, VS Code) take the same URL — see
[jitsu.com/docs/mcp](https://jitsu.com/docs/mcp) for their setup.

### Authentication

Interactive clients use **OAuth 2.1** — no API key to manage. The first tool call opens a browser
tab asking you to approve the connection; tokens are scoped, listed, and revocable from your account
settings page.

Headless environments (CI, cron, servers) use a personal API key instead — generate one on the user
settings page and pass it as `Authorization: Bearer <keyId>:<keySecret>`:

```bash
claude mcp add --transport http jitsu https://use.jitsu.com/mcp \
  --header "Authorization: Bearer $JITSU_API_KEY"
```

### What the agent can do

25 tools, covering everything the console does: read and write workspace configuration
(destinations, streams, connections, functions), query Live Events and function logs, run and cancel
connector syncs, discover source streams and inspect sync state, execute functions and profile
builders against test data, and pull event and sync statistics. Full reference:
[jitsu.com/docs/mcp](https://jitsu.com/docs/mcp).

## Architecture

Jitsu is a handful of independently scalable services:

| Service            | Stack       | What it does                                                              |
| ------------------ | ----------- | ------------------------------------------------------------------------- |
| **ingest**         | Go          | HTTP endpoint that accepts events and writes them to Kafka                |
| **rotor**          | TypeScript  | Routes events, runs Functions, applies destination-specific transforms    |
| **bulker**         | Go          | High-throughput warehouse ingestion — batching, schema management, retries |
| **sync-controller**| Go          | Orchestrates connector syncs (pulling data from third-party sources)      |
| **console**        | Next.js     | Admin UI, Management API, and the MCP server                              |

Backed by Postgres (configuration), Kafka/Redpanda (event bus), ClickHouse (live events and
metrics), and MongoDB (profiles).

[Bulker](https://github.com/jitsucom/bulker) is also usable standalone if you just want a warehouse
ingestion engine and are comfortable with low-level APIs.

## Self-hosting

Jitsu is MIT-licensed and fully self-hostable, with no usage limits and no feature gating. Cloud is
the path of least resistance; self-hosting is for when you need the data to stay inside your own
infrastructure.

### Quick start (Kubernetes / Minikube)

The development Helm chart is the recommended way to get a complete stack running locally. You'll
need [Minikube](https://minikube.sigs.k8s.io/docs/start/) (a single-node Kubernetes cluster on your
machine) and [Helm v3+](https://helm.sh/docs/intro/install/):

```bash
git clone -b newjitsu --single-branch https://github.com/jitsucom/jitsu
cd jitsu/helm

minikube start          # give the VM at least 8GB RAM
./dev-deploy.sh deploy
./dev-deploy.sh tunnel  # in a second terminal
```

`./dev-deploy.sh tunnel` runs `minikube tunnel`, which routes the cluster's LoadBalancer services to
`localhost` so you can reach them from your browser — console on `:3000`, ingest on `:3049`, bulker
on `:3042`, rotor on `:3401`, plus Postgres, ClickHouse, MongoDB and Kafka. It asks for `sudo` (it
binds privileged ports) and has to keep running in its own terminal for the whole session.

The console will be at http://localhost:3000. Full instructions:
[Self-hosting Quick Start](https://jitsu.com/docs/self-hosting/quick-start).

### Production

For real deployments, read the
[Production Deployment guide](https://jitsu.com/docs/self-hosting/production-deployment) and the
[Configuration Reference](https://jitsu.com/docs/self-hosting). It covers scaling each service,
Kafka sizing, and the environment variables every component reads.

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the repository layout, how to
set up a development environment and run the test suites, and the branch, commit and pull request
conventions.

## Community & support

- **[Slack](https://jitsu.com/slack)** — the fastest way to reach the team and other users
- **[GitHub Issues](https://github.com/jitsucom/jitsu/issues)** — bugs and feature requests
- **[Docs](https://jitsu.com/docs)** — guides and reference

## License

Jitsu is licensed under the [MIT License](LICENSE).
