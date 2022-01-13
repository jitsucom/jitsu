import { jitsuClient } from "../src/jitsu";
import { JitsuClient } from "../src/interface";
import fs from "fs"
import express from 'express'
import bodyParser from 'body-parser';
import * as core from "express-serve-static-core"

let testServer = null;

async function createTestServer()  {
  const app = express();
  app.use(bodyParser.json())
  app.use(bodyParser.text())
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
  await testServer();
});

afterAll(() => {
  if (testServer) {
    testServer.close();
  }
})

test("Test Jitsu Client npm only", async () => {
  let jitsu: JitsuClient = jitsuClient({
    fetch: jest.fn((...args) => {
      console.log("Called fetch with", args);
      return Promise.resolve();
    }),
    key: "Test",
    tracking_host: "https://some-host",
  });
  const req: Request = {};
  const res: Response = {};
  await jitsu.id(
    {
      email: "a@b.c",
      id: "someId",
    },
    true
  );

  await jitsu.track("test", {
    req,
    res,
  });
});
