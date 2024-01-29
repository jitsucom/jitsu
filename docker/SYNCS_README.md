# Syncs in Docker Compose

Syncs rely on kubernetes cluster to run jobs.

This doc is just a proof-of-concept:
In the presence of kubernetes cluster, it is not recommended to run Jitsu in Docker Compose. Instead, running all Jitsu components in kubernetes cluster is preferable.

# How to set up

Jitsu runs sync jobs in kubernetes cluster. So we need to connect `syncctl` service to kubernetes cluster using following env variables in `.env` file:

* `SYNCS_ENABLED` - set to `true` to enable syncs on UI side
* `SYNCCTL_KUBERNETES_CLIENT_CONFIG` - path to kubernetes config file or kubernetes config in yaml format
* `EXTERNAL_BULKER_HOST` - host of `bulker` service as it is reachable from kubernetes cluster
* `EXTERNAL_POSTGRES_HOST`- host of `postgres` service as it is reachable from kubernetes cluster

# How to run

## Minikube example

**Pre-requisites**

* `minikube` [installed](https://minikube.sigs.k8s.io/docs/start/)
* `kubectl` [installed](https://kubernetes.io/docs/tasks/tools/)

**Start minikube**

```shell
minikube start
```

**Set kubernetes config**

```shell
kubectl config view --raw=true --minify=true --flatten=true
```
Put the modified config payload to `SYNCCTL_KUBERNETES_CLIENT_CONFIG` env variable in `.env` file (keep indentation intact: use line break after opening quotation marks symbol)

**Adjust `.env` config**

* Set `EXTERNAL_BULKER_HOST` and `EXTERNAL_POSTGRES_HOST` to: `host.minikube.internal` as it is how these services will be reachable from minikube
* Set `SYNCS_ENABLED` to `true`

**Start Jitsu**

```shell
docker compose up
```

Keep in mind that minikube choose random port each time it starts.
So you need to update server port in config each time you restart minikube.
