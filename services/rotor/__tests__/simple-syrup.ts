import type { Application, RequestHandler } from "express";
import http from "http";
import https from "https";

const express = require("express");

const forge = require("node-forge");

export type SimpleSyrupOpts = {
  port?: number;
  https?: boolean;
  handlers?: Record<string, RequestHandler>;
};

export type SimpleSyrup = {
  app: Application;
  server: http.Server;
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
};

function getNextAvailablePort(port: number) {
  return new Promise<number>(resolve => {
    const server = http.createServer();
    server.on("error", () => {
      resolve(getNextAvailablePort(port + 1));
    });
    server.on("listening", () => {
      server.close(() => {
        resolve(port);
      });
    });
    server.listen(port);
  });
}

function generateX509Certificate(altNames: { type: number; value: string }[]) {
  const issuer = [
    { name: "commonName", value: "localhost" },
    { name: "organizationName", value: "ACME Corp" },
    { name: "organizationalUnitName", value: "XYZ Department" },
  ];
  const certificateExtensions = [
    { name: "basicConstraints", cA: true },
    {
      name: "keyUsage",
      keyCertSign: true,
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: true,
      dataEncipherment: true,
    },
    {
      name: "extKeyUsage",
      serverAuth: true,
      clientAuth: true,
      codeSigning: true,
      emailProtection: true,
      timeStamping: true,
    },
    {
      name: "nsCertType",
      client: true,
      server: true,
      email: true,
      objsign: true,
      sslCA: true,
      emailCA: true,
      objCA: true,
    },
    { name: "subjectAltName", altNames },
    { name: "subjectKeyIdentifier" },
  ];
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  cert.publicKey = keys.publicKey;
  cert.setSubject(issuer);
  cert.setIssuer(issuer);
  cert.setExtensions(certificateExtensions);
  cert.sign(keys.privateKey);
  return {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
  };
}

function shutdownFunction(server): Promise<void> {
  return new Promise<void>(resolve => {
    let resolved = false;
    const resolveIfNeeded = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    setTimeout(resolveIfNeeded, 5000);
    server.close(resolveIfNeeded);
  });
}

export function createServer(opts: SimpleSyrupOpts = {}): Promise<SimpleSyrup> {
  return new Promise<SimpleSyrup>(async (resolve, reject) => {
    const app: Application = express();
    app.use(express.json());
    const server = opts?.https ? https.createServer(generateX509Certificate([]), app) : http.createServer(app);
    const port = opts?.port ? await getNextAvailablePort(opts.port) : 0;
    server.listen(port, () => {
      const address = server.address();
      if (!address) {
        reject(new Error(`Unable to get server address`));
        return;
      }
      if (typeof address === "string") {
        reject(new Error(`Address is not an of network. This is not supported: ${address} `));
        return;
      }
      const port = address.port;
      if (opts?.handlers) {
        for (const [path, handler] of Object.entries(opts?.handlers)) {
          app.all(path, handler);
        }
      }
      resolve({
        app: app,
        port,
        close: () => shutdownFunction(server),
        baseUrl: `${opts.https ? "https" : "http"}://localhost:${port}`,
        server: server,
      });
    });
  });
}
