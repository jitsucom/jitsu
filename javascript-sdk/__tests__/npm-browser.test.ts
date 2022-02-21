/**
 * @jest-environment jsdom
 *
 * DO NOT DELETE LINE ABOVE, THIS IS AN INSTRUCTION FOR JEST
 *
 * This test suite verifies that Jitsu works as a npm package with DOM
 * env
 */

import { envs, jitsuClient } from "../src/jitsu";
import { JitsuClient } from "../src/interface";

type RequestCache = {
  url: string;
  headers: Record<string, string>;
  payload: string;
};

const requestLog: RequestCache[] = [];

class XHRMock {
  private url: string;
  private headers = {};
  private onload: any
  private status: number

  constructor() {}

  open(url: string) {
    this.url = url;
  }

  setRequestHeader(name: string, val: string) {
    this.headers[name.toLocaleLowerCase()] = val;
  }

  send(payload) {
    requestLog.push({ url: this.url, headers: this.headers, payload });
    this.status = 200;
    if (this.onload) {
      this.onload()
    }
  }
}

beforeAll(() => {
  // @ts-ignore
  window.XMLHttpRequest = XHRMock;
});

test("test browser", async () => {
  let counter = 0;
  let jitsu: JitsuClient = jitsuClient({
    key: "Test",
    tracking_host: "https://test-host.com",
    custom_headers: () => ({
      "test1": "val1",
      "test2": "val" + (counter++)
    })
  });
  await jitsu.id({ email: "john.doe@gmail.com", id: "1212" });
  await jitsu.track("page_view", { test: 1 });
  expect(requestLog.length).toBe(2)
  console.log("Requests", requestLog)
  const event1 = JSON.parse(requestLog[0].payload)
  const event2 = JSON.parse(requestLog[1].payload)

  expect(requestLog[0].headers?.test2).toBe("val0")
  expect(requestLog[1].headers?.test2).toBe("val1")

  expect(requestLog[0].headers?.test1).toBe("val1")
  expect(requestLog[1].headers?.test1).toBe("val1")

  expect(event1?.user?.anonymous_id).toBe(event2?.user?.anonymous_id)
  expect(event1?.user?.email).toBe('john.doe@gmail.com')
  expect(event2?.user?.email).toBe('john.doe@gmail.com')
  expect(event1?.user?.id).toBe('1212')
  expect(event2?.user?.id).toBe('1212')
  expect(event1.event_type).toBe('user_identify')
  expect(event2.event_type).toBe('page_view')
});
