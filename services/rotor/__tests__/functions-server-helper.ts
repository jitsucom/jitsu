// @ts-ignore
import fs from "fs";
// @ts-ignore
import path from "path";
// @ts-ignore
import zlib from "zlib";
import { promisify } from "util";
import { ChildProcess, spawn } from "child_process";
import { getLog } from "juava";
import { EnrichedConnectionConfig, FunctionConfig } from "@jitsu/destination-functions";

const gzip = promisify(zlib.gzip);
const log = getLog("functions-server-helper");

export type TestFunctionsServer = {
  port: number;
  baseUrl: string;
  configDir: string;
  process: ChildProcess;
  close: () => Promise<void>;
};

/**
 * Write test configs to a temporary directory in the format expected by functions-server
 */
export async function writeTestConfigs(
  configDir: string,
  connections: Record<string, EnrichedConnectionConfig>,
  functions: Record<string, FunctionConfig>
): Promise<void> {
  // Create directories
  const connectionsDir = path.join(configDir, "connections", "part-0");
  const functionsDir = path.join(configDir, "functions", "part-0");

  fs.mkdirSync(connectionsDir, { recursive: true });
  fs.mkdirSync(functionsDir, { recursive: true });

  // Group connections by workspaceId
  const connectionsByWorkspace = new Map<string, EnrichedConnectionConfig[]>();
  for (const conn of Object.values(connections)) {
    const wsId = conn.workspaceId;
    if (!connectionsByWorkspace.has(wsId)) {
      connectionsByWorkspace.set(wsId, []);
    }
    connectionsByWorkspace.get(wsId)!.push(conn);
  }

  // Write connections files: ${workspaceId}__connections.json.gz
  // @ts-ignore
  for (const [wsId, conns] of connectionsByWorkspace) {
    const filename = `${wsId}__connections.json.gz`;
    const filepath = path.join(connectionsDir, filename);
    const jsonData = JSON.stringify(conns);
    const compressed = await gzip(Buffer.from(jsonData, "utf-8"));
    fs.writeFileSync(filepath, compressed);
    log.atInfo().log(`Wrote ${conns.length} connections to ${filename}`);
  }

  // Write function files: ${workspaceId}__${functionId}.json.gz
  for (const func of Object.values(functions)) {
    const filename = `${func.workspaceId}__${func.id}.json.gz`;
    const filepath = path.join(functionsDir, filename);
    const jsonData = JSON.stringify(func);
    const compressed = await gzip(Buffer.from(jsonData, "utf-8"));
    fs.writeFileSync(filepath, compressed);
    log.atInfo().log(`Wrote function ${func.id} to ${filename}`);
  }
}

/**
 * Start a functions-server process for testing
 */
export async function startTestFunctionsServer(configDir: string, port: number = 3457): Promise<TestFunctionsServer> {
  // Build the rotor first if needed (functions-server is part of rotor)
  const rotorDir = path.resolve(__dirname, "..");

  // Start the functions server using ts-node
  const env = {
    ...process.env,
    PORT: String(port),
    CONFIG_DIR: configDir,
    ROTOR_MODE: "functions",
    LOG_FORMAT: "text",
  };

  const serverProcess = spawn("npx", ["tsx", "src/functions-server.ts"], {
    cwd: rotorDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Collect output for debugging
  const stderrOutput: string[] = [];
  let processExited = false;
  let exitCode: number | null = null;

  serverProcess.stdout?.on("data", data => {
    log.atInfo().log(`[functions-server] ${data.toString().trim()}`);
  });
  serverProcess.stderr?.on("data", data => {
    const msg = data.toString().trim();
    stderrOutput.push(msg);
    log.atError().log(`[functions-server] ${msg}`);
  });
  serverProcess.on("exit", code => {
    processExited = true;
    exitCode = code;
    log.atInfo().log(`[functions-server] Process exited with code ${code}`);
  });

  // Wait for server to be ready
  const baseUrl = `http://localhost:${port}`;
  await waitForServer(baseUrl, 45000, () => {
    if (processExited) {
      const errMsg = stderrOutput.join("\n");
      throw new Error(`Functions server process exited with code ${exitCode}. Stderr:\n${errMsg}`);
    }
  });

  log.atInfo().log(`Functions server started at ${baseUrl}`);

  return {
    port,
    baseUrl,
    configDir,
    process: serverProcess,
    close: async () => {
      serverProcess.kill("SIGTERM");
      // Wait for process to exit
      await new Promise<void>(resolve => {
        serverProcess.on("exit", () => resolve());
        setTimeout(resolve, 2000); // Timeout fallback
      });
      log.atInfo().log("Functions server stopped");
    },
  };
}

/**
 * Wait for server to be ready by polling health endpoint
 */
async function waitForServer(baseUrl: string, timeoutMs: number, checkForExit?: () => void): Promise<void> {
  const startTime = Date.now();
  const healthUrl = `${baseUrl}/health`;

  while (Date.now() - startTime < timeoutMs) {
    // Check if process exited early
    if (checkForExit) {
      checkForExit();
    }

    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return;
      }
    } catch (e) {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Functions server did not start within ${timeoutMs}ms`);
}

/**
 * Clean up test config directory
 */
export function cleanupTestConfigs(configDir: string): void {
  if (fs.existsSync(configDir)) {
    fs.rmSync(configDir, { recursive: true, force: true });
    log.atInfo().log(`Cleaned up test config directory: ${configDir}`);
  }
}
