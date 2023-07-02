# Jitsu 2.0

<p align="center">
👉<b>Looking for Jitsu Classic? Switch to 
<a href="https://github.com/jitsucom/jitsu/tree/master">classic branch</a>, and read about <a href="https://docs.jitsu.com/jitsu-classic">Jitsu Classic and Jitsu Next differences</a></b>
</p>
<p align="center">
<img src="https://github.com/jitsucom/jitsu/blob/newjitsu/.readme-assets/github-hero-light-mode.png?raw=true#gh-light-mode-only" />
<img src="https://github.com/jitsucom/jitsu/blob/newjitsu/.readme-assets/github-hero-dark-mode.png?raw=true#gh-dark-mode-only" />
</p>
<p align="center">
<b><a href="https://jitsu.com">Learn more »</a></b> 
</p>
<p align="center">
<a href="https://jitsu.com/slack">Slack</a> · <a href="https://jitsu.com/slack">Website</a> · <a href="https://docs.jitsu.com">Docs</a> · <a href="https://github.com/jitsucom/jitsu/blob/newjitsu/LICENSE">MIT License</a>
</p>

---
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

# What is Jitsu?

Jitsu is a tool for collecting event data from your websites, apps and stream them to your data warehouse or other servises.
It is a self-hosted, open-source alternative to Segment.

<p align="center">
<img src="https://github.com/jitsucom/jitsu/blob/feat/newjitsu_README/.readme-assets/screenshot.png?raw=true">
</p>

# Quick start

## 1. Install Jitsu

### Docker Compose

The fastest way to install jitsu is [docker compose](https://docs.jitsu.com/self-hosting/quick-start):

```bash
# Clone the repository
git clone --depth 1 https://github.com/jitsucom/jitsu
cd jitsu/docker
# Copy .env.example to .env, see instructions at https://docs.jitsu.com/self-hosting/quick-start#edit-env-file
cp .env.example .env
```

### Deploy at scale

For productions deployments, [read this guide](https://docs.jitsu.com/self-hosting/production-deployment)

### Jitsu Cloud

**Cloud version is available at [use.jitsu.com](https://use.jitsu.com). It's free up to 200k events per month, and
comes with a [FREE ClickHouse instance](https://next.jitsu.com/features/clickhouse)**

## 2. Configure Jitsu

* Follow [Quick Start Guide](https://docs.jitsu.com/)
* Get yourself familiar with [Jitsu Concepts](https://docs.jitsu.com/concepts)
* Browse [Destination Catalog](https://next.jitsu.com/integrations/destinations)

## 3. Send events

[Send events](https://docs.jitsu.com/sending-data/). Multiple SDKs are available:

* [HTML Snippet](https://docs.jitsu.com/sending-data/html)
* [React](https://docs.jitsu.com/sending-data/react) (including Next.js)
* [NPM Package](https://docs.jitsu.com/sending-data/npm). Yes, it's isomorphic and works in server-side Node.js too!
* [HTTP API](https://docs.jitsu.com/sending-data/http)
* [Segment Compatible API](https://docs.jitsu.com/sending-data/segment)

# 🚚 Bulker

Jitsu is based on [Bulker](https://github.com/jitsucom/bulker), an open-source data warehouse ingestion engine. 
Bulker can be used as a standalone tool, if you're comfortable working with low-level APIs.

# Contributing

Please see our [contributing guidelines](CONTRIBUTING.md).












