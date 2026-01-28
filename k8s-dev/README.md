# Jitsu Dev Kubernetes Helm Chart

Development Helm chart for deploying Jitsu services to Minikube. Services are built inside containers via init containers - no local build step required.

## Prerequisites

- [Minikube](https://minikube.sigs.k8s.io/docs/start/) installed and running
- [Helm](https://helm.sh/docs/intro/install/) v3+
- Host services running locally:
  - PostgreSQL (port 5432)
  - Kafka (port 9094)
  - Console (port 3000)

## Quick Start

```bash
# 1. Start minikube
minikube start

# 2. Configure secrets (interactive prompt)
./dev-deploy.sh secrets

# 3. Deploy
./dev-deploy.sh deploy

# 4. Start tunnel for localhost access (in separate terminal)
./dev-deploy.sh tunnel
```

## Configuration

### Secrets

Secrets are stored in a Kubernetes Secret (not in files). Configure them interactively:

```bash
./dev-deploy.sh secrets
```

This prompts for all required credentials and creates/updates the `jitsu-secrets` K8s Secret.

| Secret | Description |
|--------|-------------|
| `AUTH_TOKEN` | Inter-service auth token. Generate with: `openssl rand -hex 16` |
| `CONSOLE_AUTH_TOKEN` | Console API token (format: `username:token`) |
| `DATABASE_URL` | PostgreSQL connection URL (e.g., `postgresql://user:pass@host:5432/db`) |
| `CLICKHOUSE_URL` | ClickHouse connection URL (e.g., `https://user:pass@host:8443/database`) |
| `MONGODB_URL` | MongoDB connection URL (includes credentials) |

Check secrets status:
```bash
./dev-deploy.sh secrets-status
```

### Custom Configuration (Optional)

Create `values-custom.yaml` for environment-specific overrides:

```yaml
scaling:
  ingest:
    replicas: 2

env:
  common:
    LOG_FORMAT: "json"
```

## Commands

```bash
./dev-deploy.sh <command>
```

| Command | Description |
|---------|-------------|
| `secrets` | Configure secrets interactively (creates K8s Secret) |
| `secrets-status` | Show secrets configuration status |
| `deploy` | Deploy/upgrade Helm chart (auto-starts mount) |
| `mount` | Start minikube mount (project -> /project) |
| `mount-stop` | Stop minikube mount |
| `restart` | Restart all pods (triggers rebuild) |
| `restart <service>` | Restart specific service |
| `status` | Show minikube, mount, pod and service status |
| `watch` | Watch pod status |
| `logs <service>` | Show logs for a service |
| `logs <service> -f` | Follow logs for a service |
| `build-logs <service>` | Show build/init container logs |
| `delete <service>` | Delete pod (forces full recreation) |
| `clear-cache [type]` | Clear build caches (go\|node\|all) |
| `tunnel` | Start minikube tunnel (localhost access) |
| `expose` | Show URLs for exposed services |
| `uninstall` | Uninstall the Helm release |

## Services

| Service | Port | Description |
|---------|------|-------------|
| ingest | 3049 | Event ingestion service |
| bulker | 3042 | Batch processing service |
| rotor | 3401 | Event routing service |
| syncctl | 3043 | Sync controller |
| operator | 3052 | Functions server operator |

## Accessing Services

Services are exposed via LoadBalancer. Run tunnel in a separate terminal:

```bash
./dev-deploy.sh tunnel
```

Then access:
- Ingest: http://localhost:3049
- Bulker: http://localhost:3042
- Rotor: http://localhost:3401

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Minikube                                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   ingest    │  │   bulker    │  │    rotor    │         │
│  │  (Go/init)  │  │  (Go/init)  │  │ (Node/init) │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                          │                                  │
│                    jitsu-secrets                            │
│                    (K8s Secret)                             │
└──────────────────────────┼──────────────────────────────────┘
                           │
              host.minikube.internal
                           │
┌──────────────────────────┼──────────────────────────────────┐
│ Host Machine             │                                  │
│  ┌──────────┐  ┌─────────┴───┐  ┌──────────┐               │
│  │ PostgreSQL│  │    Kafka    │  │  Console │               │
│  │  :5432   │  │    :9094    │  │  :3000   │               │
│  └──────────┘  └─────────────┘  └──────────┘               │
└─────────────────────────────────────────────────────────────┘
```

## Build Caching

Build artifacts are cached in PersistentVolumeClaims:
- `go-cache` - Go modules and build cache
- `node-cache` - Node modules and build cache

Clear caches if you encounter build issues:

```bash
./dev-deploy.sh clear-cache all
```

## Troubleshooting

### Pods stuck in Init

Check build logs:
```bash
./dev-deploy.sh build-logs <service>
```

### Mount issues

Restart mount:
```bash
./dev-deploy.sh mount-stop
./dev-deploy.sh mount
```

### Services not accessible

Ensure tunnel is running:
```bash
./dev-deploy.sh tunnel
```

### Missing secrets

Configure secrets before deploying:
```bash
./dev-deploy.sh secrets
```
