import * as http from "node:http";
import * as https from "node:https";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createGuardedRequest, GuardedRequestError, guardedRequest } from "../src/functions/lib/guarded-request";

// Throwaway self-signed certificate for localhost, test data only.
const key = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCKDg20iHARL4EN
ntGLK+7IFkkAHPPLrxFgoC0t558WBBGbkBWV/5ieha/WlQjBGEOLkZTYinFBQP6h
hRltKBIJZdy4x9yJldvag/Yo/bXuZC7nfcA2RMAkXweCicy7q8Re81nB1cjgOetL
Q8h8/PWplVafetjnIfZApwDzhKRzr8eCnT7+22Ms8M19vqaTTTRWovjnUDfWUFZf
ZWSuDx5RzATVd3V+J2ondwbKJ1d6o9otbi2FfQ7fRsjN4RwpV7Be7rYdtVC39Cqv
3wawkRIeWv71U98BOSQFYusqunCRSFM5ILskcBijo8pbZihz0TU+qjDgehPiorcv
XXhiIqyTAgMBAAECggEARPJD0feZ0FtjHkRE7jZgqDjI+G99KioiiZk1NwnIH5yk
loZc4W6m7/RgHtCLcLQHd7qbFZH+gdJN2Ki6TBOI/nyKwRW/hE79X6Ir28jphUcv
TZk112R6eS+kdoMPZmKgTbNHDlEQYztJ0Wrmw9UpcyoL+tXFYZlKfHtrNDL4VnWl
S7XCJaZPo6ei4f/lzb3+w6ydojp3F4i1ICg3WT/+i8rZK+qYBBStuCgfyVCThLlv
dkLu6EFzJSk5gPncGAw80mBV7sW+BEWJVSFET+9T/ind66g9Bi4z8/SshUtZvT0N
TToEH0NqWHfi81Uer+U1bswLt8a2o2+d2qjCD9t1sQKBgQDDJH/aqn77Ciko5jiU
PrtEWQCqjrbkJW5t4AU+uE5o4p/CcIvU47SDSlJbWF0WgUoF6ytzHon3Lu5D3tGT
hZFG1EH5gnmQMnSXe6jBc3FSJLa4d36WScCJUUftNHupCTFxc/6PGZCPtsB9F0n5
AcrNaoCN2CD3EMJueFlc2XFF9QKBgQC1G9+eRr9y9g/Q8WsyvunpGD9yYZvNySGC
DzwsRLF1UJBiMNSh6Xz6QTqyGOMiscKrAp8LeKOhS/n7id7EBZbJqfu3b3tp17zi
MlSDVSeac4S89fSgqL3G+O4rs+NWUU0IxCc+2eXrmmpahZt9MxPtL73eAjZtsZYw
Iyr9opYLZwKBgCcqDyLyrvNxMZuMwPQ3ttvbxP92Dwyw2n3gxQy2br4sJYYfkmDS
pmrnIqpEjMI0hoezkA/VpDjgyV8DvCoQV3zQosERx5YCGlZAsjjJE4g56BYTnWtK
OAMXNglMTDk7qBmt/vv3VIUTV4SDhQwdqPcbFdvh8ZPEYFFNhBnXZh11AoGAfrL5
RakI1kv91JaP//g/e6pS+JoAfX5vyqUN24pS+1dZKtguaPcHT6vCfEWc4PCq1ygG
S+gh0P1t7OMOzON8EaixSCrdk7YxlazQIvC3u/2Epw0KDjr+SOxs8nXuXLyTv8Y6
DmYxyxlDvgAqPvQ0xIHZui6iFStffl2b/cR4Y5ECgYBjdARYEzGN6eLnIxv2nPlw
27l3Tl+HMmOu9ty7dqrcIBCYw6jJ5X98k34Dw1bqlhRAN3ohnfu/Lvw2wi2yL18M
K4kCEcf32Cf4yAQ5ql8cdPjvTxUGKSqsX41h01G07B9NWSosI82OrhEldwNQkNRW
M4TMWhlFkWycIkNmQ6JM2w==
-----END PRIVATE KEY-----`;
const cert = `-----BEGIN CERTIFICATE-----
MIIDJzCCAg+gAwIBAgIUHLEH++gy6qqBtpS4NlR/24abCOcwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTAwNTA3MDUzOVoYDzIxMjYw
OTExMDcwNTM5WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQCKDg20iHARL4ENntGLK+7IFkkAHPPLrxFgoC0t558W
BBGbkBWV/5ieha/WlQjBGEOLkZTYinFBQP6hhRltKBIJZdy4x9yJldvag/Yo/bXu
ZC7nfcA2RMAkXweCicy7q8Re81nB1cjgOetLQ8h8/PWplVafetjnIfZApwDzhKRz
r8eCnT7+22Ms8M19vqaTTTRWovjnUDfWUFZfZWSuDx5RzATVd3V+J2ondwbKJ1d6
o9otbi2FfQ7fRsjN4RwpV7Be7rYdtVC39Cqv3wawkRIeWv71U98BOSQFYusqunCR
SFM5ILskcBijo8pbZihz0TU+qjDgehPiorcvXXhiIqyTAgMBAAGjbzBtMB0GA1Ud
DgQWBBRwthAGqeiClwc2uwyROeyEsER6/jAfBgNVHSMEGDAWgBRwthAGqeiClwc2
uwyROeyEsER6/jAPBgNVHRMBAf8EBTADAQH/MBoGA1UdEQQTMBGCCWxvY2FsaG9z
dIcEfwAAATANBgkqhkiG9w0BAQsFAAOCAQEAhzXRXqVreLG1PcM64rOVa6RMz3ls
60Q3ftJ1pivtxi9Zg7kEjncVvfZsjlySVwhvwT7n3tgMGtAu5lZRXUwyX1z6KfZQ
ttr57OiXAcasMgnkSfUqmpMCLzpT9QmzNrqZoFlKw/ItvKru9kVA6694sUD8OZcy
A9z2vYyWc8tQ6FKegYXHZaUJJ6sijxBQqKp2ZNZJnnkANvKsfq/a7wpGlHfUe55u
fiELUIXDJYpnLmd7kNcpGCtkKywc/gZe/3W5glzpz0kF///4ZI/QATh7llcjXEN1
IrFzTWYZJ4KmBvWNsgikb3J5ma1fPF94Oaltsbc28CqFhlZrbeIV9TwXIg==
-----END CERTIFICATE-----`;

const servers: Array<http.Server | https.Server> = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(s => new Promise<void>(resolve => (s.closeAllConnections(), s.close(() => resolve()))))
  );
});

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void;
async function listen(handler: Handler, tls = false) {
  const requests: Array<{ method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string }> = [];
  const onRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body);
    });
  };
  const server = tls ? https.createServer({ key, cert }, onRequest) : http.createServer(onRequest);
  servers.push(server);
  let connections = 0;
  server.on("connection", () => connections++);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { port, requests, connections: () => connections };
}

const allowAll = { isBlocked: () => false };
const local = (port: number, path = "/") => `http://127.0.0.1:${port}${path}`;
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected the request to fail");
    },
    error => error as GuardedRequestError
  );

describe("guarded request: address checks", () => {
  it.each([
    "http://127.0.0.1:1/",
    "http://10.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://[::1]/",
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fe80::1]/",
    "http://0.0.0.0/",
    "http://2130706433/",
    "http://0x7f.1/",
    "https://192.168.1.1/",
  ])("refuses an IP-literal host before any connection: %s", async url => {
    const error = await failure(guardedRequest({ url }));
    expect(error).toBeInstanceOf(GuardedRequestError);
    expect(error.code).toBe("blocked_address");
    expect(error.maybeDelivered).toBe(false);
  });

  it("never reaches a server on a blocked address", async () => {
    const { port, requests } = await listen((_req, res) => res.end("secret"));
    const error = await failure(guardedRequest({ url: local(port), body: "{}" }));
    expect(error.code).toBe("blocked_address");
    expect(requests).toHaveLength(0);
  });

  it("refuses a hostname that resolves to a private address", async () => {
    const { port, requests } = await listen((_req, res) => res.end());
    const request = createGuardedRequest({
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
      isBlocked: address => address.startsWith("127."),
    });
    const error = await failure(request({ url: `http://internal.example:${port}/` }));
    expect(error.code).toBe("blocked_address");
    expect(error.maybeDelivered).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("refuses a hostname when any one of its addresses is not public", async () => {
    const { port, requests } = await listen((_req, res) => res.end());
    const request = createGuardedRequest({
      resolve: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
      isBlocked: address => address.startsWith("127."),
    });
    expect((await failure(request({ url: `http://mixed.example:${port}/` }))).code).toBe("blocked_address");
    expect(requests).toHaveLength(0);
  });

  it("checks again on every connection, so a rebinding answer is caught", async () => {
    const { port } = await listen((_req, res) => res.end());
    let answers = 0;
    const request = createGuardedRequest({
      // First answer is treated as public, the second as private: same name, different address.
      resolve: async () => [{ address: ++answers === 1 ? "127.0.0.1" : "127.0.0.2", family: 4 }],
      isBlocked: address => address === "127.0.0.2",
      keepAlive: false, // one connection per request, so the second request resolves the name again
    });
    const url = `http://rebind.example:${port}/`;
    expect((await request({ url })).status).toBe(200);
    expect((await failure(request({ url }))).code).toBe("blocked_address");
  });

  it("reports a DNS failure as not delivered", async () => {
    const request = createGuardedRequest({
      resolve: async () => {
        throw Object.assign(new Error("nope"), { code: "ENOTFOUND" });
      },
    });
    const error = await failure(request({ url: "http://missing.example/" }));
    expect(error.code).toBe("dns_error");
    expect(error.maybeDelivered).toBe(false);
  });

  it.each([
    "ftp://example.com/",
    "file:///etc/passwd",
    "gopher://example.com/",
    "not a url",
    "http://user:pass@example.com/",
  ])("rejects an unusable URL: %s", async url => {
    const error = await failure(guardedRequest({ url }));
    expect(error.code).toBe("invalid_url");
    expect(error.maybeDelivered).toBe(false);
  });
});

describe("guarded request: delivery", () => {
  it("sends method, headers and body and returns the status", async () => {
    const { port, requests } = await listen((_req, res) => res.writeHead(204).end());
    const request = createGuardedRequest(allowAll);
    const response = await request({
      url: local(port, "/hook?a=1"),
      headers: { "content-type": "application/json", "x-token": "abc" },
      body: '{"hello":"world"}',
    });
    expect(response).toEqual({ status: 204, retryAfter: undefined, truncated: false });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "POST", url: "/hook?a=1", body: '{"hello":"world"}' });
    expect(requests[0].headers["content-type"]).toBe("application/json");
    expect(requests[0].headers["x-token"]).toBe("abc");
    expect(requests[0].headers["content-length"]).toBe("17");
  });

  it.each([200, 400, 422, 429, 500, 503])("returns status %i without throwing", async status => {
    const { port } = await listen((_req, res) => res.writeHead(status).end());
    expect((await createGuardedRequest(allowAll)({ url: local(port) })).status).toBe(status);
  });

  it("exposes Retry-After as received", async () => {
    const { port } = await listen((_req, res) => res.writeHead(429, { "retry-after": "7" }).end());
    expect((await createGuardedRequest(allowAll)({ url: local(port) })).retryAfter).toBe("7");
  });

  it("does not follow redirects", async () => {
    const { port, requests } = await listen((req, res) => {
      if (req.url === "/start") res.writeHead(302, { location: "/internal-only" }).end();
      else res.end("internal");
    });
    const response = await createGuardedRequest(allowAll)({ url: local(port, "/start") });
    expect(response.status).toBe(302);
    expect(requests.map(r => r.url)).toEqual(["/start"]);
  });

  it("stops reading a large response body and reports it", async () => {
    const { port } = await listen((_req, res) => {
      res.writeHead(200);
      const chunk = Buffer.alloc(16 * 1024, "a");
      const timer = setInterval(() => res.write(chunk), 1);
      res.on("close", () => clearInterval(timer));
    });
    const started = Date.now();
    const response = await createGuardedRequest(allowAll)({ url: local(port), maxResponseBytes: 32 * 1024 });
    expect(response.status).toBe(200);
    expect(response.truncated).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("reports a 101 Switching Protocols answer as a status right away instead of waiting for the timeout", async () => {
    const { port } = await listen((_req, res) => {
      // http.request emits `upgrade`, not the response callback, for a 101: it must not be left hanging.
      res.socket!.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: x\r\nConnection: Upgrade\r\n\r\n");
    });
    const started = Date.now();
    const response = await createGuardedRequest(allowAll)({ url: local(port), body: "{}", totalTimeoutMs: 5000 });
    expect(response.status).toBe(101);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("returns the status even if the connection drops while the body is read", async () => {
    const { port } = await listen((_req, res) => {
      res.writeHead(202);
      res.write("partial");
      setTimeout(() => res.socket?.destroy(), 20);
    });
    expect((await createGuardedRequest(allowAll)({ url: local(port) })).status).toBe(202);
  });
});

describe("guarded request: connection reuse", () => {
  it("sends sequential requests over one connection", async () => {
    const { port, requests, connections } = await listen((_req, res) => res.writeHead(204).end());
    const request = createGuardedRequest(allowAll);
    for (let i = 0; i < 5; i++) expect((await request({ url: local(port), body: "{}" })).status).toBe(204);
    expect(requests).toHaveLength(5);
    expect(connections()).toBe(1);
  });

  it("opens a connection per request when reuse is turned off", async () => {
    const { port, connections } = await listen((_req, res) => res.writeHead(204).end());
    const request = createGuardedRequest({ ...allowAll, keepAlive: false });
    for (let i = 0; i < 3; i++) await request({ url: local(port), body: "{}" });
    expect(connections()).toBe(3);
  });

  it("reuses one TLS connection too", async () => {
    const { port, connections } = await listen((_req, res) => res.writeHead(204).end(), true);
    const request = createGuardedRequest({ ...allowAll, ca: cert });
    for (let i = 0; i < 3; i++) {
      expect((await request({ url: `https://localhost:${port}/`, body: "{}" })).status).toBe(204);
    }
    expect(connections()).toBe(1);
  });

  it("opens a new connection when the server closed the pooled one, and checks the address again", async () => {
    const { port, connections } = await listen((_req, res) => {
      res.setHeader("connection", "close"); // the server ends the connection after this answer
      res.end();
    });
    let answers = 0;
    const request = createGuardedRequest({
      resolve: async () => [{ address: ++answers === 1 ? "127.0.0.1" : "127.0.0.2", family: 4 }],
      isBlocked: address => address === "127.0.0.2",
    });
    const url = `http://rebind.example:${port}/`;
    expect((await request({ url })).status).toBe(200);
    expect(connections()).toBe(1);
    expect((await failure(request({ url }))).code).toBe("blocked_address");
    expect(connections()).toBe(1);
  });

  it("replaces a pooled connection the server closed while it was idle", async () => {
    const { port, connections } = await listen((req, res) => {
      res.writeHead(204).end();
      setTimeout(() => req.socket.destroy(), 10);
    });
    const request = createGuardedRequest(allowAll);
    expect((await request({ url: local(port), body: "{}" })).status).toBe(204);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect((await request({ url: local(port), body: "{}" })).status).toBe(204);
    expect(connections()).toBe(2);
  });

  it("reports a reset on a reused connection as maybe delivered", async () => {
    let seen = 0;
    const { port } = await listen((req, res) => {
      if (++seen === 1) return res.writeHead(204).end();
      req.socket.destroy(); // the request arrived and the connection dies without an answer
    });
    const request = createGuardedRequest(allowAll);
    expect((await request({ url: local(port), body: "{}" })).status).toBe(204);
    const error = await failure(request({ url: local(port), body: "{}" }));
    expect(error.code).toBe("connection_error");
    expect(error.maybeDelivered).toBe(true);
    expect(error.detail).toBe("ECONNRESET");
  });
});

describe("guarded request: failures", () => {
  it("times out when the server never answers, and says a connection existed", async () => {
    const { port } = await listen(() => undefined);
    const error = await failure(createGuardedRequest(allowAll)({ url: local(port), totalTimeoutMs: 150 }));
    expect(error.code).toBe("timeout");
    expect(error.maybeDelivered).toBe(true);
    expect(error.detail).toBeUndefined();
  });

  it("reports a refused connection as not delivered, with the system error code as detail", async () => {
    const { port } = await listen((_req, res) => res.end());
    await Promise.all(
      servers.splice(0).map(s => new Promise<void>(resolve => (s.closeAllConnections(), s.close(() => resolve()))))
    );
    const error = await failure(createGuardedRequest(allowAll)({ url: local(port) }));
    expect(error.code).toBe("connection_error");
    expect(error.maybeDelivered).toBe(false);
    expect(error.detail).toBe("ECONNREFUSED");
    expect(error.message).toBe("connection_error"); // the detail never becomes part of the message
  });

  it("reports a reset after the connection as maybe delivered, with the system error code as detail", async () => {
    const { port } = await listen(req => req.socket.destroy());
    const error = await failure(createGuardedRequest(allowAll)({ url: local(port), body: "{}" }));
    expect(error.code).toBe("connection_error");
    expect(error.maybeDelivered).toBe(true);
    expect(error.detail).toBe("ECONNRESET");
    expect(error.message).toBe("connection_error");
  });

  it("honours an abort signal", async () => {
    const { port } = await listen(() => undefined);
    const controller = new AbortController();
    const pending = failure(createGuardedRequest(allowAll)({ url: local(port), signal: controller.signal }));
    setTimeout(() => controller.abort(), 50);
    const error = await pending;
    expect(error.code).toBe("aborted");
  });

  it("refuses to start when the signal is already aborted", async () => {
    const error = await failure(guardedRequest({ url: "https://example.com/", signal: AbortSignal.abort() }));
    expect(error.code).toBe("aborted");
    expect(error.maybeDelivered).toBe(false);
  });

  it("carries only a code, never the URL, headers or body", async () => {
    const error = await failure(
      guardedRequest({
        url: "http://127.0.0.1/secret-path?token=abc",
        headers: { authorization: "Bearer abc" },
        body: "private",
      })
    );
    expect(error.message).toBe("blocked_address");
    expect(JSON.stringify({ message: error.message, name: error.name, code: error.code })).not.toMatch(
      /secret|token|Bearer|private/
    );
  });
});

describe("guarded request: TLS", () => {
  it("rejects a self-signed certificate, as not delivered", async () => {
    const { port, requests } = await listen((_req, res) => res.end(), true);
    const error = await failure(createGuardedRequest(allowAll)({ url: `https://127.0.0.1:${port}/`, body: "{}" }));
    expect(error.code).toBe("tls_error");
    expect(error.maybeDelivered).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("delivers over TLS when the certificate is trusted", async () => {
    const { port, requests } = await listen((_req, res) => res.writeHead(200).end(), true);
    const response = await createGuardedRequest({ ...allowAll, ca: cert })({
      url: `https://localhost:${port}/hook`,
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(requests).toHaveLength(1);
  });

  it("still applies the address check to https", async () => {
    expect((await failure(guardedRequest({ url: "https://10.1.2.3/" }))).code).toBe("blocked_address");
  });
});
