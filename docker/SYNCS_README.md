# Syncs in Docker Compose

Syncs rely on kubernetes cluster to run jobs.

This doc is just a proof-of-concept:
In the presence of kubernetes cluster, it is not recommended to run Jitsu in Docker Compose. Instead, running all Jitsu components in kubernetes cluster is preferable.

# How to set up

Jitsu runs sync jobs in kubernetes cluster. So we need to connect `syncctl` service to kubernetes cluster using following env variables:

* `SYNCS_ENABLED` - set to `true` to enable syncs on UI side
* `SYNCCTL_KUBERNETES_CLIENT_CONFIG` - path to kubernetes config file or kubernetes config in yaml format
* `EXTERNAL_BULKER_HOST` - host of `bulker` service as it is reachable from kubernetes cluster
* `EXTERNAL_DATABASE_HOST`- host of `postgres` service as it is reachable from kubernetes cluster

# How to run


## Minikube example

Pre-requisites:

* `kubectl` installed
* `minikube` installed

**Start minikube**

```shell
minikube start
```

**Get kubernetes config**

```shell
kubectl config view
```

**Copy minikube keys and certs to docker-compose volume**

* Check config for certificates, keys and CA file paths. 
* Copy them to `data/syncctl` folder
* That folder is mounted to `syncctl` service to `/etc/syncctl` path
* Change paths in config to the new location of files in `/etc/syncctl` folder
* Change server host in config to `kubernetes` (that hostname is mapped to docker host in `syncctl` service and minikube certificates are signed for that host)
* Put the modified config payload to `SYNCCTL_KUBERNETES_CLIENT_CONFIG` env variable in `.env` file (keep indentation intact: use line break after opening quotation mark symbol)
* Set `EXTERNAL_BULKER_HOST` and `EXTERNAL_DATABASE_HOST` to: `host.minikube.internal` as it is how these services will be reachable from minikube
* Run docker compose `docker-compose --profile syncs up`

Keep in mind that minikube choose random port each time it starts.
So you need to update server port in config each time you restart minikube.
