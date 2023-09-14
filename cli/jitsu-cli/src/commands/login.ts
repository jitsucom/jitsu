import open from "open";
import express from "express";
import { randomId } from "juava";

export async function login({ host, apikey }: { host: string; apikey?: string }) {
  console.log("login:", host, apikey);
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
      console.log(`Example app listening!`);
      const addr = server.address() as any;
      await open(url + "?origin=jitsu-cli&c=" + c + "&redirect=http://localhost:" + addr.port + "/");
    });
    app.get("/", (req, res) => {
      res.send("Hello World!");
      server.close();
    });
  } catch (e) {
    console.error("Failed to open browser, please open this url in your browser:", url);
  }
}
