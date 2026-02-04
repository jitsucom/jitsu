import { db } from "./db";
import { getServerLog } from "./log";
import { createHash, hash, randomId } from "juava";
import { pickSlug, pickWorkspaceName } from "../shared/name-utils";
import { getServerEnv } from "./serverEnv";

const log = getServerLog("seed");

const DEMO_DESTINATION_NAME = "Demo Postgres Destination";
const DEMO_STREAM_NAME = "Demo Stream";

interface ParsedPostgresUrl {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  schema: string;
  sslMode: "disable" | "require" | "verify-ca" | "verify-full";
}

/**
 * Parses PostgreSQL connection URL and extracts connection details.
 * Format: postgresql://user:password@host:port/database?schema=schema&sslmode=disable
 */
function parseDatabaseUrl(url: string): ParsedPostgresUrl {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
      throw new Error(`Invalid protocol: ${parsed.protocol}`);
    }

    const username = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    const host = parsed.hostname;
    const port = parsed.port ? parseInt(parsed.port, 10) : 5432;
    const database = parsed.pathname.slice(1);

    const searchParams = new URLSearchParams(parsed.search);
    const schema = searchParams.get("schema") || "public";
    const sslmode = searchParams.get("sslmode") || "disable";

    // Map sslmode to valid values
    let sslMode: ParsedPostgresUrl["sslMode"];
    if (sslmode === "disable") {
      sslMode = "disable";
    } else if (sslmode === "verify-ca") {
      sslMode = "verify-ca";
    } else if (sslmode === "verify-full") {
      sslMode = "verify-full";
    } else {
      sslMode = "require";
    }

    return {
      host,
      port,
      database,
      username,
      password,
      schema,
      sslMode,
    };
  } catch (error: any) {
    log.atError().withCause(error).log(`Failed to parse DATABASE_URL`);
    throw new Error(`Failed to parse DATABASE_URL: ${error?.message}`, { cause: error });
  }
}

/**
 * Checks if the destination is the initial demo destination
 */
function isInitialDestination(config: any): boolean {
  return config?.name === DEMO_DESTINATION_NAME;
}

/**
 * Checks if the stream is the initial demo stream
 */
function isInitialStream(config: any): boolean {
  return config?.name === DEMO_STREAM_NAME;
}

export async function seedUserAndWorkspace(): Promise<void> {
  const serverEnv = getServerEnv();
  const profileCount = await db.prisma().userProfile.count();
  if (profileCount === 0 && serverEnv.SEED_USER_EMAIL && serverEnv.SEED_USER_PASSWORD) {
    const email = serverEnv.SEED_USER_EMAIL;
    const [username] = email.split("@");
    const password = serverEnv.SEED_USER_PASSWORD;
    const userId = toId(serverEnv.SEED_USER_EMAIL);
    log.atDebug().log(`Adding a seed admin user with id ${userId} and email ${email}`);
    await db.prisma().userProfile.create({
      data: {
        id: userId,
        email: email,
        name: username,
        externalId: userId,
        loginProvider: "credentials",
        admin: true,
        password: {
          create: {
            hash: createHash(password),
            changeAtNextLogin: true,
          },
        },
      },
    });
    const workspaceName = pickWorkspaceName(email, username);
    const newWorkspace = await db.prisma().workspace.create({
      data: {
        name: workspaceName,
        slug: pickSlug(email, workspaceName),
      },
    });
    await db.prisma().workspaceAccess.create({
      data: { userId: userId, workspaceId: newWorkspace.id, role: "owner" },
    });
  }
}

/**
 * Seeds the database with demo connections.
 * This function is idempotent and only runs if SEED_DEMO_CONFIGURATION env var is set.
 */
export async function seedDemoConnections(): Promise<void> {
  const serverEnv = getServerEnv();
  if (!serverEnv.SEED_DEMO_CONFIGURATION) {
    log.atInfo().log("SEED_DEMO_CONFIGURATION not set, skipping seed");
    return;
  }

  if (!serverEnv.DATABASE_URL) {
    log.atError().log("DATABASE_URL not set, cannot seed demo connections");
    throw new Error("DATABASE_URL not set, cannot seed demo connections");
  }

  try {
    log.atInfo().log("Starting demo connections seed");

    // Ensure database connection is established
    await db.prisma.waitInit();

    // Get the first workspace
    const workspace = await db.prisma().workspace.findFirst({
      where: { deleted: false },
      orderBy: { createdAt: "asc" },
    });

    if (!workspace) {
      log.atError().log("No workspace found, cannot seed demo connections");
      throw new Error("No workspace found, cannot seed demo connections");
    }

    const workspaceId = workspace.id;
    log.atInfo().log(`Seeding demo connections for workspace: ${workspaceId}`);

    // Parse DATABASE_URL
    const dbConfig = parseDatabaseUrl(serverEnv.DATABASE_URL);
    log.atInfo().log(`Parsed database config: host=${dbConfig.host}, database=${dbConfig.database}`);

    // Use "jitsu-data" schema instead of the one from DATABASE_URL
    const targetSchema = serverEnv.DEMO_DESTINATION_SCHEMA || "jitsu-data";

    // 1. Handle Demo Destination
    const existingDestinations = await db.prisma().configurationObject.findMany({
      where: {
        workspaceId,
        type: "destination",
        deleted: false,
      },
    });

    let destinationId: string;
    const demoDestination = existingDestinations.find(d => isInitialDestination(d.config));

    const destinationConfig = {
      name: DEMO_DESTINATION_NAME,
      destinationType: "postgres",
      authenticationMethod: "password",
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      username: dbConfig.username,
      password: dbConfig.password,
      defaultSchema: targetSchema,
      sslMode: dbConfig.sslMode,
    };

    if (demoDestination) {
      // Update existing demo destination
      log.atInfo().log(`Updating existing demo destination: ${demoDestination.id}`);
      await db.prisma().configurationObject.update({
        where: { id: demoDestination.id },
        data: { config: destinationConfig },
      });
      destinationId = demoDestination.id;
    } else if (existingDestinations.length === 0) {
      // No destinations exist, create the demo destination
      log.atInfo().log("No destinations found, creating demo destination");
      destinationId = `${workspaceId.substring(0, 8)}-dest-${randomId(8)}`;
      await db.prisma().configurationObject.create({
        data: {
          id: destinationId,
          workspaceId,
          type: "destination",
          config: destinationConfig,
        },
      });
    } else {
      // Other destinations exist, don't create demo
      log.atInfo().log(`Found ${existingDestinations.length} existing destination(s), skipping demo seed`);
      return;
    }

    // 2. Handle Demo Stream
    const existingStreams = await db.prisma().configurationObject.findMany({
      where: {
        workspaceId,
        type: "stream",
        deleted: false,
      },
    });

    let streamId: string;
    const demoStream = existingStreams.find(s => isInitialStream(s.config));

    const streamConfig = {
      name: DEMO_STREAM_NAME,
      domains: [],
      authorizedJavaScriptDomains: undefined,
      publicKeys: [],
      privateKeys: [],
    };

    if (demoStream) {
      // Update existing demo stream
      log.atInfo().log(`Updating existing demo stream: ${demoStream.id}`);
      await db.prisma().configurationObject.update({
        where: { id: demoStream.id },
        data: { config: streamConfig },
      });
      streamId = demoStream.id;
    } else if (existingStreams.length === 0) {
      // No streams exist, create the demo stream
      log.atInfo().log("No streams found, creating demo stream");
      streamId = `${workspaceId.substring(0, 8)}-stream-${randomId(8)}`;
      await db.prisma().configurationObject.create({
        data: {
          id: streamId,
          workspaceId,
          type: "stream",
          config: streamConfig,
        },
      });
    } else {
      // Other streams exist, don't create demo
      log.atInfo().log(`Found ${existingStreams.length} existing stream(s), skipping demo seed`);
      return;
    }

    // 3. Handle Link between Demo Stream and Demo Destination
    const existingLink = await db.prisma().configurationObjectLink.findFirst({
      where: {
        workspaceId,
        fromId: streamId,
        toId: destinationId,
        deleted: false,
        type: "push", // streaming mode
      },
    });

    if (!existingLink) {
      log.atInfo().log(`Creating link between stream ${streamId} and destination ${destinationId}`);
      const linkId = `${workspaceId}-${streamId.substring(streamId.length - 4)}-${destinationId.substring(
        destinationId.length - 4
      )}-${randomId(6)}`;
      await db.prisma().configurationObjectLink.create({
        data: {
          id: linkId,
          workspaceId,
          fromId: streamId,
          toId: destinationId,
          type: "push",
          data: {
            mode: "batch",
            primaryKey: "message_id",
            deduplicate: true,
            timestampColumn: "timestamp",
            dataLayout: "segment-single-table",
            batchSize: 10000,
            frequency: 5,
          },
        },
      });
    } else {
      log.atInfo().log(`Link between stream and destination already exists: ${existingLink.id}`);
    }

    log.atInfo().log("✅ Demo connections seed completed successfully");
  } catch (error) {
    log.atError().withCause(error).log("Failed to seed demo connections");
    throw error;
  }
}

function toId(email: string) {
  return hash("sha256", email.toLowerCase().trim());
}
