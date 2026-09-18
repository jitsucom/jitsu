# Reverse ETL deployment (JITSU-227)

This is the **development chart**, not the cloud production deployment. It builds
syncctl/console from the mounted checkout, but Reverse ETL jobs use a separately
built `retl-runner` image. Updating the checkout does not update that image.
Deployment and the destructive schema cutover remain manual.

## Before enabling

1. Follow the [schema cutover](#schema-cutover-and-rollback) below if upgrading an
   existing installation. Keep test syncs paused throughout setup.
2. Build/publish the `retl-runner` target in `all.Dockerfile` from the same revision
   as syncctl and console, or use the corresponding services release image. The
   image uses Node 24 (`node:sqlite` needs Node >=22.13). For Minikube, load a local
   image into its image store and use a unique, non-`latest` tag; otherwise use a
   registry reachable by the cluster. The default Kubernetes image-pull policy
   applies. This chart does not build the runner or configure private-registry pull secrets.
3. Provision a private GCS/S3 bucket and runner identity as described below. Keep
   bucket/prefix stable across runs and recoveries. Never apply age-only deletion
   to this prefix: old baselines and pending batches can still be live references.
4. Provision an existing Kubernetes Secret in the release namespace. Keep its
   credentials out of Helm values (which are retained in Helm release history).
   Use a restricted [runtime database login](../services/retl-runner/README.md), not
   the login used by the chart's Prisma schema hook.

Required runtime Secret keys:

| Key | Value |
| --- | --- |
| `RETL_DATABASE_URL` | Runtime PostgreSQL URL with `?schema=newjitsu` (or the actual console schema) |
| `RETL_CONSOLE_URL` | Console origin reachable **from the Pod**, e.g. `http://console:3000` |
| `RETL_CONSOLE_TOKEN` | The console's `SYNCCTL_AUTH_KEY` |
| `RETL_OBJECT_STORE` | `gcs` or `s3` |
| `RETL_OBJECT_BUCKET` | Existing bucket name |

Optional keys: `RETL_OBJECT_PREFIX` (default `reverse-etl/`), `RETL_S3_REGION`
(default `us-east-1`), `RETL_S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`. An S3 endpoint must be reachable from
Pods and support conditional `PutObject`; custom endpoints use path-style access.
If using workload identity, omit static AWS credential keys entirely.

Use `values-custom.yaml` (names only, never Secret contents):

```yaml
reverseEtl:
  enabled: true
  runnerImage: jitsucom/retl-runner:<version-from-this-rollout>
  runtimeSecret: retl-runtime
  serviceAccount:
    create: true
    name: retl-runner
    annotations: {} # See cloud authentication below.
  resources:
    requests: { cpu: "100m", memory: "256Mi", ephemeral-storage: "1Gi" }
    limits: { cpu: "1", memory: "8Gi", ephemeral-storage: "4Gi" }
  scratchSizeLimit: "2Gi"
```

Helm requires a runner image and Secret name when enabled and rejects enablement
with zero syncctl replicas. It validates values and renders only the Secret name;
it cannot validate external Secret contents, bucket access or image availability.
Kubernetes requires all five keys before starting a runner; Node validates their values.
The workspace `reverse-etl` feature and the sync's enabled flag still control
admission. Enabling the controller alone does not enable a sync or workspace.

Move old `REVERSE_*` / `SYNCCTL_REVERSE_*` settings from `env.common` or
`env.syncctl` into `reverseEtl`; conflicting overrides now fail rendering. Explicit
prefixed environment settings also take precedence over inherited Secret envFrom.
Other syncctl repository/auth settings are unchanged.

## Cloud authentication

The chart creates a **dedicated** runner service account (default
`<release>-retl-runner`) with namespace-scoped Lease get/create/update/delete
permissions. It does not grant Secret API access or cloud IAM. Ordinary connector
jobs keep their separate `sync-pod` identity. For a pre-provisioned dedicated
account use `serviceAccount.create: false`, set `name`, and apply annotations
externally; Helm still creates the namespace Lease role/binding.

- **GCS on GKE:** enable Workload Identity on the cluster/node pool and bind the
  Kubernetes account to a Google IAM account using the
  [GKE setup instructions](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/workload-identity).
  With the linked-account method, set
  `iam.gke.io/gcp-service-account: retl@PROJECT.iam.gserviceaccount.com` in
  `serviceAccount.annotations`. Grant that identity object create/read on the
  bucket/prefix. ADC discovers the identity; Google Ads OAuth is unrelated.
- **S3 on EKS:** configure the IAM trust and bucket policy, then set
  `eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/retl-runner` as documented
  for [IRSA](https://docs.aws.amazon.com/eks/latest/userguide/associate-service-account-role.html).
  The admission webhook supplies the token file and AWS identity environment;
  the runner's SDK uses its default credential chain. Grant `s3:GetObject` and
  `s3:PutObject` for the prefix (plus the required KMS permissions if using SSE-KMS).
- **Minikube / S3-compatible:** cloud annotations alone do not provide credentials
  on Minikube. Use a reachable S3-compatible store with scoped AWS credential keys
  in the runtime Secret. GCS key-file mounting is not implemented by this chart;
  use an environment with working ADC/Workload Identity for GCS.

No object deletion/listing is required by the runner. Do not use public buckets.
Protect artifacts as sensitive payloads, including hashed identifiers; configure
provider encryption at rest and auditing. IAM provisioning is an operator step,
not an action performed by Helm.

## Resources and scratch space

All scheduled, manual and recovery runs use the same resource settings. syncctl
validates positive quantities, requests <= limits, and scratch <= ephemeral-storage
limit **at startup**, before creating workloads. CPU/memory defaults match the
previous runner. The new disk defaults request 1 GiB, limit 4 GiB, and cap the
disk-backed `/tmp` emptyDir at 2 GiB. Leave headroom outside `/tmp` for container logs.
The SQLite main file is separately capped at 1 GiB; raising Pod disk limits does
not raise that application limit. Journals, temporary files and object buffers
need additional disk/memory. Size requests for the intended workload and node
capacity; a limit is not a disk reservation. Monitor disk pressure, evictions and OOMs.

The root filesystem stays read-only and the process non-root. Scratch is
disposable; durable snapshots/receipts live in object storage. No PVC or MongoDB
is needed. Changing these settings changes the CronJob template hash, so syncctl
reconciles future runs; already-running Pods retain their original settings.

Outside this chart the corresponding syncctl settings are
`SYNCCTL_REVERSE_SERVICE_ACCOUNT`, `SYNCCTL_REVERSE_RUNNER_RESOURCES` (JSON
`requests`/`limits`), and `SYNCCTL_REVERSE_SCRATCH_SIZE_LIMIT`. Omitting the new
service account setting retains the existing `SYNCCTL_PODS_SERVICE_ACCOUNT` fallback.

## Schema cutover and rollback

**Do not start `helm upgrade` or `dev-deploy.sh deploy` until old workers are
stopped.** The chart's `prisma db push` is a **pre-upgrade hook**: it runs before
the new syncctl/console deployment. Setting `reverseEtl.enabled: false` in that
upgrade does not stop existing workers before the hook. Existing CronJobs also
survive disabling the controller; the flag is not a kill switch.

Follow the [full cutover/reset procedure](../services/retl-runner/src/artifacts/README.md#deployment):
pause syncs and block new admission, drain old scheduled/manual/recovery workers,
back up the database, reconcile outstanding remote requests using the old
runner/schema, and explicitly retire/reset test syncs and audiences. Do not delete
recovery evidence while a worker or provider request can still change the audience.

Then apply the reviewed Prisma schema with schema-owner credentials and explicit
operator approval for dropping the six old payload tables and accounting columns.
The chart deliberately **never** passes `--accept-data-loss`; nonempty destructive
changes must fail the hook, not silently discard membership state. After the
approved schema application, upgrade the chart/image, verify storage access and
create a fresh disabled test sync (new empty managed audience for mirroring).
Enable only that test sync after verification. Old null artifact heads are rejected;
there is no automatic migration or reset.

The install hook clears and regenerates its cached **generated Zod schemas** so
removed models cannot linger. It does not clear database state or objects.
Pause/drain before disabling the chart feature or removing its service account,
since existing jobs still require the identity and Lease permissions.

Rollback is not just selecting the old image: old binaries require the removed
tables and cannot recover artifact-backed state. Pause/drain first and use a
coordinated database restore plus provider reconciliation. Retain all artifacts
referenced by live heads and backups; do not change bucket/prefix as a reset.

## Offline validation

```sh
helm lint helm --strict --set projectRoot=/tmp/jitsu
python3 -m unittest discover -s helm/tests -v # Helm + PyYAML required
cd bulker/sync-controller && go test -vet=off ./... -count=1
```

CI runs these contract checks without deploying a cluster or using cloud credentials.
