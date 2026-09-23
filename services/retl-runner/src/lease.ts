import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request } from "node:https";
import { ensure, PersistenceError } from "./persistence/types";
import { KubernetesHttpError } from "./diagnostics";

export const reverseResourceName = (syncId: string) =>
  `reverse-${createHash("sha256").update(syncId).digest("hex").slice(0, 32)}`;
type Lease = {
  apiVersion: "coordination.k8s.io/v1";
  kind: "Lease";
  metadata: { name: string; resourceVersion?: string; uid?: string };
  spec: { holderIdentity: string; leaseDurationSeconds: number; renewTime: string };
};
export type LeaseRequest = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: Lease }>;
export interface RunLease {
  acquire(): Promise<void>;
  renew(): Promise<void>;
  release(): Promise<void>;
}

// Kubernetes MicroTime requires exactly six fractional digits; JS ISO dates emit only three.
const microTimeNow = () => new Date().toISOString().replace(/Z$/, "000Z");

/** CAS updates; never renew an expired lease or delete a replacement owner's lease. */
export class KubernetesLease implements RunLease {
  private readonly collection: string;
  private readonly name: string;
  private held = false;
  constructor(private readonly call: LeaseRequest, namespace: string, syncId: string, private readonly holder: string) {
    ensure(/^[a-z0-9-]+$/.test(namespace) && holder.length > 0, "Invalid Kubernetes lease scope");
    this.collection = `/apis/coordination.k8s.io/v1/namespaces/${namespace}/leases`;
    this.name = reverseResourceName(syncId);
  }
  private active(lease: Lease) {
    return Date.parse(lease.spec?.renewTime) + lease.spec?.leaseDurationSeconds * 1000 > Date.now();
  }
  private async get() {
    return this.call("GET", `${this.collection}/${this.name}`);
  }
  async acquire() {
    const current = await this.get();
    if (current.status !== 404 && current.status !== 200)
      throw new PersistenceError("Kubernetes lease read failed", { cause: new KubernetesHttpError(current.status) });
    ensure(current.status === 404 || !this.active(current.body), "Reverse sync already running");
    const lease: Lease = {
      apiVersion: "coordination.k8s.io/v1",
      kind: "Lease",
      metadata: {
        name: this.name,
        ...(current.status === 200 ? { resourceVersion: current.body.metadata.resourceVersion } : {}),
      },
      spec: { holderIdentity: this.holder, leaseDurationSeconds: 60, renewTime: microTimeNow() },
    };
    const saved = await this.call(
      current.status === 404 ? "POST" : "PUT",
      current.status === 404 ? this.collection : `${this.collection}/${this.name}`,
      lease
    );
    if (![200, 201].includes(saved.status))
      throw new PersistenceError("Kubernetes lease acquisition failed", {
        cause: new KubernetesHttpError(saved.status),
      });
    this.held = true;
  }
  async renew() {
    const current = await this.get();
    ensure(
      this.held &&
        current.status === 200 &&
        current.body.spec.holderIdentity === this.holder &&
        this.active(current.body),
      "Kubernetes ownership lost"
    );
    current.body.spec.renewTime = microTimeNow();
    ensure(
      (await this.call("PUT", `${this.collection}/${this.name}`, current.body)).status === 200,
      "Kubernetes lease renewal failed"
    );
  }
  async release() {
    if (!this.held) return;
    const current = await this.get();
    if (current.status === 200 && current.body.spec.holderIdentity === this.holder) {
      await this.call("DELETE", `${this.collection}/${this.name}`, {
        apiVersion: "v1",
        kind: "DeleteOptions",
        preconditions: { uid: current.body.metadata.uid, resourceVersion: current.body.metadata.resourceVersion },
      });
    }
    this.held = false;
  }
}

/** In-cluster TLS with the projected service-account CA; token is reloaded for rotation. */
export function inClusterLeaseRequest(host: string, port: string): LeaseRequest {
  ensure(/^[a-zA-Z0-9.:-]+$/.test(host) && /^\d+$/.test(port), "Invalid Kubernetes API address");
  return async (method, path, body) => {
    const root = "/var/run/secrets/kubernetes.io/serviceaccount";
    const [token, ca] = await Promise.all([readFile(`${root}/token`, "utf8"), readFile(`${root}/ca.crt`)]);
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: host,
          port,
          path,
          method,
          ca,
          headers: {
            authorization: `Bearer ${token.trim()}`,
            "content-type": "application/json",
          },
        },
        res => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 1_000_000) req.destroy(new Error("Kubernetes response too large"));
            else chunks.push(chunk);
          });
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode ?? 500, body: JSON.parse(Buffer.concat(chunks).toString()) });
            } catch {
              reject(new PersistenceError("Invalid Kubernetes response"));
            }
          });
          res.on("error", () => reject(new PersistenceError("Kubernetes request failed")));
        }
      );
      const deadline = setTimeout(() => req.destroy(new Error("Kubernetes deadline exceeded")), 5000);
      req.on("close", () => clearTimeout(deadline));
      req.on("error", cause => reject(new PersistenceError("Kubernetes request failed", { cause })));
      req.end(body ? JSON.stringify(body) : undefined);
    });
  };
}
