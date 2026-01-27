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

# 2. Configure secrets
cp values-secrets.example.yaml values-secrets.yaml
# Edit values-secrets.yaml with your credentials

# 3. (Optional) Configure external services
cp values-custom.example.yaml values-custom.yaml
# Edit values-custom.yaml with ClickHouse host, etc.

# 4. Deploy
./dev-deploy.sh deploy

# 5. Start tunnel for localhost access (in separate terminal)
./dev-deploy.sh tunnel
```

## Configuration Files

| File | Purpose | Committed to Git |
|------|---------|------------------|
| `values.yaml` | Default configuration | ✅ Yes |
| `values-custom.yaml` | Custom config overrides (hosts, URLs, etc.) | ❌ No |
| `values-secrets.yaml` | Secrets (passwords, tokens) | ❌ No |

Files are loaded in order: `values.yaml` → `values-custom.yaml` → `values-secrets.yaml`

### Required Secrets

Create `values-secrets.yaml` from the example:

```bash
cp values-secrets.example.yaml values-secrets.yaml
```

Required values:

| Secret | Description |
|--------|-------------|
| `secrets.authToken` | Inter-service auth token. Generate with: `openssl rand -hex 16` |
| `secrets.consoleAuthToken` | Console API token (format: `username:token`) |
| `secrets.databaseUrl` | PostgreSQL connection URL (e.g., `postgresql://user:pass@host:5432/db`) |
| `secrets.clickhousePassword` | ClickHouse password |
| `secrets.mongodbUrl` | MongoDB connection URL (includes credentials) |

### External Configuration

Create `values-custom.yaml` for environment-specific non-secret config:

```bash
cp values-custom.example.yaml values-custom.yaml
```

```yaml
clickhouse:
  host: "your-clickhouse-host:8443"
  url: "https://your-clickhouse-host:8443/"
  username: "your-username"
  database: "your-database"
  metricsSchema: "your-metrics-schema"
  ssl: "true"
```

## Commands

```bash
./dev-deploy.sh <command>
```

| Command | Description |
|---------|-------------|
| `deploy` | Deploy/upgrade Helm chart (auto-starts mount) |
| `mount` | Start minikube mount (project → /project) |
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

### Secret errors on deploy

Ensure `values-secrets.yaml` exists and has all required values:
```bash
cp values-secrets.example.yaml values-secrets.yaml
# Edit and fill in all values
```
