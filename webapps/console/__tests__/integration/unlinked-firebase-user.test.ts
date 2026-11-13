import { describe, expect, it, vi } from "vitest";
import { randomId } from "juava";
import { seedWorkspace } from "./support/harness";
import workspaceRoute from "../../pages/api/workspace/index";
import meRoute from "../../pages/api/me";

// A Firebase account that has signed in but not yet been linked by /api/fb-auth/create-user has a verified token and no
// `internalId` custom claim: getFirebaseUser returns `internalId: decodedIdToken.internalId`, which is undefined, and
// create-user itself relies on that (it refuses a user that already has one). These tests feed the real getUser and the
// real route handlers exactly that principal.
const firebase = vi.hoisted(() => ({ user: undefined as any }));
vi.mock("../../lib/server/firebase-server", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/server/firebase-server")>()),
  isFirebaseEnabled: () => true,
  getFirebaseUser: async () => firebase.user,
}));

async function call(handler: any, method: string, query: any = {}) {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    headers: {} as Record<string, any>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: any) {
      this.body = b;
      return this;
    },
    send(b: any) {
      this.body = b;
      return this;
    },
    setHeader(k: string, v: any) {
      this.headers[k] = v;
    },
    getHeader(k: string) {
      return this.headers[k];
    },
    end() {},
  };
  const req = { method, headers: { host: "localhost" }, query, cookies: {}, url: "/" };
  let threw: any;
  try {
    await handler(req, res);
  } catch (e) {
    threw = e;
  }
  return { res, threw, text: JSON.stringify(res.body ?? "") };
}

describe("a verified Firebase account that is not linked yet (no internalId)", () => {
  it("cannot list workspaces: /api/workspace and /api/me?workspaces=true refuse", async () => {
    const admin = await seedWorkspace({ admin: true });
    const member = await seedWorkspace();
    firebase.user = {
      name: "New Person",
      email: `new-${randomId(6)}@example.com`,
      loginProvider: "firebase/password",
      externalId: `fb-${randomId(8)}`,
      internalId: undefined,
      authType: "firebase",
    };
    try {
      const foreign = [admin.workspace.id, member.workspace.id, admin.workspace.slug!, member.workspace.slug!];

      // the real handlers must refuse, and in any case must not return another account's workspaces
      const ws = await call(workspaceRoute, "GET");
      expect(ws.res.statusCode).toBeGreaterThanOrEqual(400);
      for (const id of foreign) expect(ws.text).not.toContain(id);

      const me = await call(meRoute, "GET", { workspaces: "true" });
      expect(me.threw ?? me.res.statusCode >= 400).toBeTruthy();
      for (const id of foreign) expect(me.text).not.toContain(id);
    } finally {
      firebase.user = undefined;
    }
  });
});
