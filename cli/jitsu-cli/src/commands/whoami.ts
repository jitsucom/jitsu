import { homedir } from "os";
import * as fs from "fs";
import { readFileSync } from "fs";
import { b } from "../lib/chalk-code-highlight";

export async function whoami({ host, apikey, force }: { host: string; apikey?: string; force?: boolean }) {
  if (!apikey) {
    const jitsuFile = `${homedir()}/.jitsu/jitsu-cli.json`;
    if (!fs.existsSync(jitsuFile)) {
      console.log("You are not logged in. Log in with `jitsu-cli login` or provide --apikey option");
      return;
    }
    const loginInfo = JSON.parse(readFileSync(jitsuFile, { encoding: "utf-8" }));
    if (loginInfo.host) {
      host = loginInfo.host;
    }
    apikey = loginInfo.apikey;
  }
  if (!host) {
    host = "https://use.jitsu.com";
  }
  if (!host.endsWith("/")) {
    host += "/";
  }
  const res = await fetch(`${host}api/me`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apikey}`,
    },
  });

  if (!res.ok) {
    console.error(
      `Login is invalid (${res.status}). Please login once again with \`jitsu-cli login -f\`, or provide a valid --apikey option`
    );
    process.exit(1);
  }

  const me = await res.json();
  if (!me.auth) {
    console.error(
      `Login is invalid. Please login once again with \`jitsu-cli login -f\`, or provide a valid --apikey option`
    );
  }

  console.log(`You are logged in as ${b(me.user.email)} at ${host}. Internal userId: ${b(me.user.internalId)}`);
}
