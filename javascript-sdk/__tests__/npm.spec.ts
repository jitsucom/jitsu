import { envs, jitsuClient } from "../src/jitsu"
import { JitsuClient } from "../src/interface";
import fs from "fs"
import express from 'express'
import bodyParser from 'body-parser';
import * as core from "express-serve-static-core"
import * as nodeFetch from "cross-fetch"
const fetch = require('fetch-cookie')(nodeFetch)

let testServer = null;

const fetchLog = [];
const fetchMock = (...args) => {
  const [url, ...params] = args;
  console.log("Called fetch with", args);
  fetchLog.push({url: url, params: [...params]});
  return Promise.resolve();
};

async function createTestServer()  {
  const app = express();
  app.use(bodyParser.json())
  app.use(bodyParser.text())
  app.get('/test/page', async (req: core.Request, res: core.Response) => {
    let jitsu: JitsuClient = jitsuClient({
      fetch: fetchMock,
      key: "Test",
      tracking_host: "https://test-host.com",
    });
    console.log('Processed. Sending data to Jitsu')
    try {
      await jitsu.track('page_view', {test: 1, env: envs.express(req, res)});
      res.status(200).send({status: 'ok'});
    } catch (e) {
      console.error("Jitsu track failed!", e)
      res.status(500).send({status: 'error'});
    }
  })
  testServer = await listen(app);
}

function listen(app: core.Express): Promise<any> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      (server.address() as any).port
      resolve(server);
    })
  })
}



beforeAll(async () => {
  await createTestServer();
  console.log('Test server started on ' + testServer.address().port)
});

afterAll(() => {
  if (testServer) {
    testServer.close();
  }
})

test("Test Jitsu Client npm only", async () => {
  fetchLog.length = 0
  let testResult = await fetch(`http://localhost:${testServer.address().port}/test/page?utm_source=1&gclid=2`);
  testResult.headers.get('set-cookie')
  expect(testResult.status).toBe(200)
  expect(fetchLog.length).toBe(1)
  let body = JSON.parse(fetchLog[0].params[0].body)
  console.log("Jitsu Track Payload", body);
});
