#!/usr/bin/env node
/**
 * Management CLI for Jitsu Console
 *
 * Usage:
 *   pnpm manage seed                      - Seed demo connections
 *   pnpm manage password-hash [secret]    - Generate password hash
 *   pnpm manage help                      - Show help
 *   pnpm manage --help | -h | -?          - Show help
 *   pnpm manage <command> --help          - Show command-specific help
 *
 *   node build/manage.js seed             - (In Docker)
 */

// When running in Docker, env vars should be set via -e flags

import minimist from "minimist";
import { seedDemoConnections, seedUserAndWorkspace } from "../lib/server/seed";
import { createHash, randomId } from "juava";
import { getServerLog } from "../lib/server/log";
import { getServerEnv } from "../lib/server/serverEnv";

const log = getServerLog("manage");

interface Command {
  description: string;
  usage?: string;
  handler: (args: minimist.ParsedArgs) => Promise<void>;
}

const commands: Record<string, Command> = {
  seed: {
    description: "Seed demo connections (stream, destination, and link)",
    usage: "pnpm manage seed",
    handler: async () => {
      console.log("🌱 Checking seed conditions...");
      await seedUserAndWorkspace();
      await seedDemoConnections();
      // Note: seedDemoConnections() logs its own status messages
    },
  },
  "password-hash": {
    description: "Generate password hash",
    usage: "pnpm manage password-hash [secret]",
    handler: async args => {
      // Get the secret from remaining positional args (after the command name)
      const secret = args._.length > 1 ? args._[1] : randomId({ digits: 32, strongRandom: true });

      if (args._.length <= 1) {
        log.atInfo().log("No secret provided, generating a random one");
      }

      const serverEnv = getServerEnv();
      log
        .atInfo()
        .log(
          `Calculating password hash. Using ${
            serverEnv.GLOBAL_HASH_SECRET || serverEnv.CONSOLE_TOKEN_SECRET
              ? "custom token secret"
              : "default hash secret"
          }`
        );
      log.atInfo().log(`Hashing ${secret} → ${createHash(secret)}`);
    },
  },
  help: {
    description: "Show this help message",
    handler: async () => {
      console.log("Jitsu Console Management CLI\n");
      console.log("Usage:");
      console.log("  pnpm manage <command> [options]\n");
      console.log("Available commands:");
      for (const [name, cmd] of Object.entries(commands)) {
        const usage = cmd.usage || `pnpm manage ${name}`;
        console.log(`  ${name.padEnd(15)} - ${cmd.description}`);
        console.log(`  ${" ".repeat(15)}   Usage: ${usage}`);
      }
      console.log("\nHelp options:");
      console.log("  pnpm manage --help                 # Show this help");
      console.log("  pnpm manage -h                     # Short form");
      console.log("  pnpm manage -?                     # Alternative");
      console.log("  pnpm manage <command> --help       # Show help for specific command");
    },
  },
};

async function main() {
  const args = minimist(process.argv.slice(2), {
    alias: { h: "help", "?": "help" },
    boolean: ["help"],
  });

  // Get the command from the first positional argument
  let commandName = args._[0];

  // Show general help if no command or if help flags are used without a command
  if (!commandName || (commandName !== "help" && (args.help || args.h || args["?"]))) {
    await commands.help.handler(args);
    process.exit(commandName ? 0 : 1);
  }

  // Check if command exists
  const command = commands[commandName];
  if (!command) {
    console.error(`Unknown command: ${commandName}\n`);
    await commands.help.handler(args);
    process.exit(1);
  }

  // Show command-specific help if --help or -? is used with a command
  if (args.help || args.h || args["?"]) {
    console.log(`\n${commandName}: ${command.description}\n`);
    console.log(`Usage: ${command.usage || `pnpm manage ${commandName}`}\n`);

    // Add command-specific examples if needed
    if (commandName === "password-hash") {
      console.log("Examples:");
      console.log("  pnpm manage password-hash mysecret    # Hash a specific password");
      console.log("  pnpm manage password-hash             # Generate and hash a random password\n");
    }
    process.exit(0);
  }

  try {
    await command.handler(args);
  } catch (error) {
    console.error("❌ Command failed:", error);
    process.exit(1);
  }
}

main();
