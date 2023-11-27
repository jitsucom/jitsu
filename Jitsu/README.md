<p align="center">
  <a href="https://jitsu.com">
  <img title="Jitsu" src='https://jitsu.com/img/jitsu-light.svg' width="400px"/>
  </a>
</p>

<br />



<p align="center">
<a href="https://github.com/jitsucom/jitsu/releases/latest"><img src="https://img.shields.io/github/v/release/jitsucom/jitsu?sort=semver" alt="Latest Version"></a>
<a href="https://jitsu.com/docs"><img src="https://img.shields.io/badge/docs-jitsu.com/docs-purple.svg" alt="Jitsu Documentation"></a>
<a href="https://jitsu.com/slack"><img src="https://img.shields.io/badge/slack-join-purple.svg" alt="Jitsu Slack"></a>
<a href="https://circleci.com/gh/jitsucom/jitsu/tree/master"><img src="https://circleci.com/gh/jitsucom/jitsu/tree/master.svg?style=shield&amp;circle-token=52a01ca8af325a73c950df2aa1953f68933383c3" alt="Master Build"></a>
<a href="https://cloud.jitsu.com"><img src="https://img.shields.io/github/license/jitsucom/jitsu" alt="License"></a>
</p>

<table border="0" style="border: 0"><tr>
  <td>
    <img src="https://raw.githubusercontent.com/jitsucom/jitsu/master/artwork/destinations_screen.png" />
  </td>  
  <td>
    <img src="https://raw.githubusercontent.com/jitsucom/jitsu/master/artwork/sources_screen.png" />
  </td>  
</tr></table>

**[Jitsu](https://jitsu.com/?utm_source=gh)** is an open source high-performance data collection service. It can:

* Capture events your application generates and stream to Data Warehouse;
* Pull data from APIs and save it to Data Warehouse

Read more about [our features](https://jitsu.com/#features) and check out the [platform overview](https://jitsu.com/overview)!

<a href="#"><img align="right" src="https://raw.githubusercontent.com/jitsucom/jitsu/master/artwork/quickstart.gif" width="40px" height="40px"/></a>
## Quick Start

Two easiest ways to start Jitsu are Heroku deployment and local docker-compose. 

### 1-click Heroku deploy
It may take up to 5 minutes for Heroku to install environment. 
After that you can visit `<your_app_name>.herokuapp.com`

<a href="https://heroku.com/deploy?template=https://github.com/jitsucom/jitsu"><img src="https://www.herokucdn.com/deploy/button.svg" width="250px" /></a>

### Docker Compose
Start Jitsu using docker-compose:

```bash
git clone https://github.com/jitsucom/jitsu.git
cd jitsu
```

Add permission for writing log files:

```bash
#Ubuntu/Mac OS
chmod -R 777 compose-data/
```

For running `latest` version use:

```bash
docker-compose up
```

Note: `latest` image will be downloaded and started.

Visit `http://localhost:8000/configurator` after the build is complete.

To learn more check out [Jitsu deployment documentation](https://jitsu.com/docs/deployment/):

- [Docker deployment](https://jitsu.com/docs/deployment/deploy-with-docker)
- [Heroku Deployment](https://jitsu.com/docs/deployment/deploy-on-heroku)
- [Plural Deployment (On Kubernetes)](https://jitsu.com/docs/deployment/deploy-on-plural)  
- [Building from sources](https://jitsu.com/docs/deployment/build-from-sources)

Also, we maintain a [Jitsu.Cloud](https://cloud.jitsu.com) — a hosted version of Jitsu. Jitsu.Cloud [is free](https://jitsu.com/pricing) for up to 250,000 events per month. Each
project comes with demo PostgresSQL Database (up 10,000 records).


<a href="#"><img align="right" src="https://raw.githubusercontent.com/jitsucom/jitsu/master/artwork/doc-n.png" width="40px"/></a>
## Documentation

Please see our extensive documentation [here](https://jitsu.com/docs). Key sections include:

* [Deployment](https://jitsu.com/docs/deployment) - Getting Jitsu running on Heroku, Docker, and building from source.
* [Configuration](https://jitsu.com/docs/configuration) - How to modify Jitsu Server's `yaml` file.
* [Geo Data](https://jitsu.com/docs/geo-data-resolution) - Configuring data enrichment with [MaxMind](https://www.maxmind.com/en/home).
* [Scaling](https://jitsu.com/docs/other-features/scaling-eventnative) - How to setup a distributed deployment of Jitsu.


<a href="#"><img align="right" src="https://raw.githubusercontent.com/jitsucom/jitsu/master/artwork/com-n.png" width="40px"/></a>
## Reporting Bugs and Contributing Code

* Want to report a bug or request a feature? Please open [an issue](https://github.com/jitsucom/jitsu/issues/new).
* Want to help us build **Jitsu**? Fork the project, and check our an issues [that are good for first pull request](https://github.com/jitsucom/jitsu/issues?q=is%3Aopen+is%3Aissue+label%3A%22Good+first+issue%22)!
* Questions? Join our [Slack](https://jitsu.com/slack)!
* [hello@jitsu.com](mailto:hello@jitsu.com) - send us an email if you have any questions!
