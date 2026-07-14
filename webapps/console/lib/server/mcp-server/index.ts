import type { NextApiRequest, NextApiResponse } from "next";
import type { PrismaClient } from "@prisma/client";
import type { ClickHouseClient } from "@clickhouse/client";
import type { Pool } from "pg";
import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { db } from "../db";
import { consoleKv, type FireAndForget, type KvStore } from "../kv";
import { clickhouse } from "../clickhouse";
import { getServerLog } from "../log";
import { AuthChecker } from "./auth";
import { OAuthHandlers } from "./oauth";
import { registerTools } from "./tools";
import { ConfigObjectsService } from "../config-objects-service";
import { EventsLogService } from "../events-log-service";
import { SyncService } from "../sync-service";
import { DebugService } from "../debug-service";
import { ReportsService } from "../reports-service";

const log = getServerLog("mcp-server");

// We DI things with lifecycle (prisma, kv) or realistic test alternatives.
// Pure utilities — getPublicOrigin(), getUser() — are imported and called
// inline where needed; wiring them through the constructor was overhead
// without payoff.
export interface McpServerDeps {
  prisma: PrismaClient;
  kv: KvStore;
  /** ClickHouse client for the events-log/sync/report tools. Defaults to the shared singleton. */
  clickhouse?: ClickHouseClient;
  /** Postgres pool for the raw-SQL sync/report queries. Defaults to the shared singleton. */
  pgPool?: Pool;
  accessTokenTtlSec?: number;
  refreshTokenTtlDays?: number;
  /** Override the fire-and-forget scheduler (e.g. pass `after` from next/server
   *  when running inside an App Router route handler). Defaults to a plain
   *  detached promise, safe in Pages Router and non-request contexts. */
  fireAndForget?: FireAndForget;
}

// Single class that owns the MCP harness. All page handlers in pages/api/mcp/*
// are 1-line wrappers that delegate here. Constructor takes every dep
// explicitly — never reaches for db.prisma()/consoleKv internally — so the
// class is testable via `new McpServer({ prisma: fakePrisma, ... })`.
export class McpServer {
  private readonly oauth: OAuthHandlers;
  private readonly auth: AuthChecker;
  private readonly configObjects: ConfigObjectsService;
  private readonly eventsLog: EventsLogService;
  private readonly syncs: SyncService;
  private readonly debug: DebugService;
  private readonly reports: ReportsService;

  constructor(private readonly deps: McpServerDeps) {
    this.oauth = new OAuthHandlers({
      prisma: deps.prisma,
      kv: deps.kv,
      accessTokenTtlSec: deps.accessTokenTtlSec ?? 3600,
      refreshTokenTtlDays: deps.refreshTokenTtlDays ?? 90,
    });
    this.auth = new AuthChecker(deps.prisma, deps.fireAndForget);
    this.configObjects = new ConfigObjectsService({ prisma: deps.prisma });
    const ch = deps.clickhouse ?? clickhouse;
    const pgPool = deps.pgPool ?? db.pgPool();
    this.eventsLog = new EventsLogService({ clickhouse: ch, prisma: deps.prisma });
    this.syncs = new SyncService({ prisma: deps.prisma, pgPool, clickhouse: ch });
    this.debug = new DebugService({ prisma: deps.prisma });
    this.reports = new ReportsService({ prisma: deps.prisma, pgPool, clickhouse: ch });
  }

  // ─── OAuth endpoints ────────────────────────────────────────────────────
  handleRegister = (req: NextApiRequest, res: NextApiResponse) => this.oauth.register(req, res);
  handleApprove = (req: NextApiRequest, res: NextApiResponse) => this.oauth.approve(req, res);
  handleDeny = (req: NextApiRequest, res: NextApiResponse) => this.oauth.deny(req, res);
  handleToken = (req: NextApiRequest, res: NextApiResponse) => this.oauth.token(req, res);

  // ─── Discovery ──────────────────────────────────────────────────────────
  handleAuthServerMetadata = (req: NextApiRequest, res: NextApiResponse) => this.oauth.authServerMetadata(req, res);
  handleProtectedResourceMeta = (req: NextApiRequest, res: NextApiResponse) =>
    this.oauth.protectedResourceMetadata(req, res);

  // ─── MCP transport ──────────────────────────────────────────────────────
  // Stateless mode: each request gets a fresh SdkMcpServer + transport pair.
  // No in-memory session state — safe for multi-instance deployments.
  // SSE reconnect / persistent sessions require an external event bus and
  // can be added in a follow-up when real tools need it.
  handleMcpRequest = async (req: NextApiRequest, res: NextApiResponse) => {
    const authInfo = await this.auth.requireAccessToken(req, res);
    if (!authInfo) return; // 401 already sent

    const sdkServer = new SdkMcpServer({ name: "jitsu", version: "0.1.0" });
    registerTools(sdkServer, {
      service: this.configObjects,
      eventsLog: this.eventsLog,
      syncs: this.syncs,
      debug: this.debug,
      reports: this.reports,
      req,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    // The SDK reads auth from req.auth — do not pass authInfo as the third arg
    // (parsedBody), which would make the transport treat it as the request body.
    (req as any).auth = authInfo;
    try {
      await sdkServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      log.atError().withCause(e).log("MCP transport error");
      if (!res.writableEnded) {
        res.status(500).json({ error: "internal_error" });
      }
    }
  };

  // ─── Used by /api/user/keys DELETE handler ──────────────────────────────
  deleteUserApiTokenWithMcpCascade = (refreshTokenId: string) =>
    this.oauth.deleteUserApiTokenWithMcpCascade(refreshTokenId);
}

// Singleton wiring — the only place that calls our service singletons.
export const mcpServer = new McpServer({
  prisma: db.prisma(),
  kv: consoleKv(),
});
