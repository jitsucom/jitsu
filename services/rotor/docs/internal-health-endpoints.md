# Internal health endpoints (JITSU-13)

Public liveness responses expose only their existing status word. Failure checks
and HTTP success/failure codes are unchanged; detailed failures remain in logs.
Clients that previously parsed operational details from health responses must
switch to the authenticated diagnostics endpoint.

| Service | Public probe | Diagnostics | Authentication |
| --- | --- | --- | --- |
| Bulker / bulker2 | `GET /health`, `GET /ready` | `GET /status` | Existing service bearer token |
| Config keeper | `GET /health` | `GET /admin/health` | Existing service bearer token |
| Rotor | `GET /health` | `GET /status` | Existing rotor bearer token |
| Functions server | `/health` and `/` | `POST /status` with an empty body | Existing Ed25519 request signature, bound to deployment ID |
| Ingest | `GET /health` | Existing readiness endpoint and failure logs | Existing configuration |

Config keeper uses `/admin/health` to avoid reserving another repository name
under its existing `/:repository` route. Functions-server diagnostics use POST
to match the existing `signFunctionsRequest` helper; the signature is verified
before returning connection/runtime identifiers, config paths or worker IDs.
Diagnostics responses are marked no-store.

The Go and rotor endpoints retain the service's existing auth configuration.
Production must configure bearer tokens (as for its other admin APIs); a
self-hosted service deliberately running without auth does not gain it here.
No new public ingress routes are needed. Use cluster networking or a trusted
port-forward to read diagnostics.

Operator, sync controller and ingress manager already return minimal health
responses. Imgproxy's generic running response needs no application change.
Readiness checks outside the shared Bulker health handler and `/version` are
outside this change. Existing Kubernetes probes inspect status codes, so their
paths and failure thresholds need no update.

Roll out the affected service images manually. The public DNS inventory and
wildcard retirement plan are tracked separately in the infrastructure PR for
JITSU-13; do not remove the active ingest, imgproxy or Nextlytics routes as part
of this deployment.
