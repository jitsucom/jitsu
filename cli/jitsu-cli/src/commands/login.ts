import open from "open";
import express from "express";
import { decrypt, randomId } from "juava";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import readline from "readline";
import { red } from "../lib/chalk-code-highlight";
import * as fs from "fs";
import inquirer from "inquirer";

const origin = "jitsu-cli";
export async function logout({ force }: { force?: boolean }) {
  const jitsuFile = `${homedir()}/.jitsu/jitsu-cli.json`;
  if (fs.existsSync(jitsuFile)) {
    if (force) {
      fs.unlinkSync(jitsuFile);
    } else {
      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: "Are you sure you want to logout?",
          default: false,
        },
      ]);
      if (confirm) {
        fs.unlinkSync(jitsuFile);
      } else {
        console.log("Logout cancelled");
        return;
      }
    }
    console.log("You are logged out");
  } else {
    console.log("You are not logged in");
  }
}

export async function login({ host, apikey, force }: { host: string; apikey?: string; force?: boolean }) {
  const jitsuFile = `${homedir()}/.jitsu/jitsu-cli.json`;
  if (fs.existsSync(jitsuFile) && !force) {
    const loginInfo = JSON.parse(readFileSync(jitsuFile, { encoding: "utf-8" }));
    console.error(
      red(
        `Error: seems like you already logged into jitsu at ${loginInfo.host}. If you want to re-login again, use --force flag, or logout first with \`jitsu-cli logout\` command`
      )
    );
    process.exit(1);
  }
  if (apikey) {
    writeFileSync(jitsuFile, JSON.stringify({ host, apikey }, null, 2));
    console.info(`\nSuccess!`);
    return;
  }
  let url = host;
  if (!url.startsWith("http")) {
    if (url.startsWith("localhost") || url.match(/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/)) {
      url = "http://" + url;
    } else {
      url = "https://" + url;
    }
  }
  if (!url.endsWith("/")) {
    url += "/";
  }
  try {
    const app = express();
    const c = randomId(32);
    const server = app.listen(0, async () => {
      const addr = server.address() as any;
      const r = await open(`${url}?origin=${origin}&c=${c}&redirect=http://localhost:${addr.port}/`);
      const int = setInterval(() => {
        if (r.exitCode !== null) {
          clearInterval(int);
          if (r.exitCode !== 0) {
            console.log(`Please open this url in your browser:\n${url}?origin=${origin}&c=${c}`);
            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            console.log("\nSuccessful authorization will provide you with a code.");
            rl.question("Please paste it here: ", code => {
              processCode(code, c, host);
              rl.close();
            });
            server.close();
          } else {
            console.log("Opening a browser window to proceed with authorization...");
          }
        }
      }, 100);
    });
    app.get("/", (req, res) => {
      if (req.query.code) {
        processCode(req.query.code as string, c, host);
        res.setHeader("Location", `${url}/cli`);
        res.status(302).send();
        server.close();
        process.exit(0);
      } else {
        const err = req.query.err as string;
        console.error(red(`Error: ${err}`));
        res.setHeader("Location", `${url}/cli?err=${err}`);
        res.status(302).send();
        server.close();
        process.exit(1);
      }
    });
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

function processCode(code: string, key: string, host: string) {
  try {
    const iv = `${origin}${code.substring(0, 16 - origin.length)}`;
    const enc = code.substring(16 - origin.length);
    const decoded = decrypt(key, iv, enc);
    const { plaintext, id } = JSON.parse(decoded);
    mkdirSync(`${homedir()}/.jitsu`, { recursive: true });
    writeFileSync(
      `${homedir()}/.jitsu/jitsu-cli.json`,
      JSON.stringify({ host, apikey: `${id}:${plaintext}` }, null, 2)
    );
    console.info(`\nSuccess!`);
  } catch (e) {
    console.error(`\n${red("Incorrect code value")}`);
    process.exit(1);
  }
}
