/* istanbul ignore file */

import express from 'express';
import http from 'http';
import playwrite, { ConsoleMessage } from 'playwright';
import * as fs from 'fs';
import { Browser, Response, Request } from 'playwright/types/types';
import path from 'path';
import bodyParser from 'body-parser';

type Callback = (() => void) | null;

async function sleep(ms: number) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve(undefined);
    }, ms)
  });

}

async function createServer(app: any, port?: number): Promise<{ port: number, shutdown: Callback }> {
  return new Promise((resolve, reject) => {
    let server = http.createServer(app);
    server.listen(port || 0, () => {
      // @ts-ignore
      let port: number = server.address().port
      console.log(`Server has been started at http://localhost:${port}`)
      resolve({
        port, shutdown: () => {
          console.log("Closing server");
          server.close()
        }
      });
    })
  })
}

export class TestServer {
  private app: any = null;
  private port?: number;
  private shutdown: Callback = null;
  private _requestLog: any[] = [];

  public async init() {
    this.app = express();
    this.app.use(bodyParser.json())
    this.app.use(bodyParser.text())
    const { port, shutdown } = await createServer(this.app, this.port)
    this.port = port;
    this.shutdown = shutdown;

    let libJs = __dirname + '/../../dist/web/lib.js';
    if (!fs.existsSync(libJs)) {
      throw new Error(`File ${libJs} does not exists. Please, run the build first!`);
    }
    this.app.use("/s/lib.js", express.static(libJs));
    this.app.get('/test-case/:name', (req, res, next) => {
      let path = `${__dirname}/../html/${req.params.name}`;
      let html = fs.readFileSync(path).toString();
      res.send(html.split('%%SERVER%%').join(`http://localhost:${this.port}`))
      next();
    });

    const eventHandler = (req, res, next) => {
      let bodyJson = typeof req.body === 'object' ? req.body : JSON.parse(req.body);
      this._requestLog.push(bodyJson);
      console.log("Received payload from JS SDK", JSON.stringify(bodyJson, null, 2));
    }

    this.app.post('/api/v1/event', eventHandler)
    this.app.post('/api.*', eventHandler)
  }

  constructor(port?: number) {
    this.port = port;
  }

  public stop() {
    if (this.shutdown) {
      this.shutdown();
    }
  }

  getUrl(url: string) {
    while (url.charAt(0) === '/') {
      url = url.substring(1);
    }
    return `http://localhost:${this.port}/${url ?? ''}`;
  }

  clearRequestLog() {
    this._requestLog = [];
  }

  get requestLog(): any[] {
    return this._requestLog;
  }
}

export type PageResult = {
  pageResponse: Response,
  allRequests: Request[],
  consoleErrors: string[]
}

/**
 * Opens an url with given browser:
 * - throws an exception (fails the test) if result is not successful
 * - takes a screenshot and saves it to `artifacts`
 * @param browser
 * @param url
 */
export async function runUrl(browser: Browser, url: string): Promise<PageResult> {
  let allRequests: Request[] = [];
  let consoleErrors: string[] = [];
  const page = await browser.newPage();
  page.on('request', request => {
    console.log("Page requested " + request.url())
    allRequests.push(request)
  });
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
    console.log(`Browser console message: [${msg.type()}] ${msg.text()}`);
  } )
  let artifactsDir = __dirname + '/../artifacts/';
  let screenshotPath = artifactsDir + url.replace("http://", "").replace("https://", "").split("/").join("_") + ".png";
  let result = await page.goto(url);
  console.log(`Saving screenshot of ${url} to ${screenshotPath}`);
  await page.screenshot({path: screenshotPath})

  expect(result?.ok()).toBeTruthy()

  console.log("Waiting")
  await sleep(4000);

  await page.close();
  return {allRequests, consoleErrors, pageResponse: result as Response};
}


