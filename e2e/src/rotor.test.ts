import { expect, jest, test, beforeAll, afterAll } from "@jest/globals";

import { e2eTestEnabled, prepareTestEnvironment, TestEnv } from "./env";

let testEnv: TestEnv;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  if (!e2eTestEnabled()) {
    return;
  }
  [testEnv, cleanup] = await prepareTestEnvironment();
});

test("Test full sync", async () => {
  if (!e2eTestEnabled(true)) {
    return;
  }
  console.log("Test full sync");
});

afterAll(async () => {
  if (cleanup) {
    await cleanup();
  }
});
