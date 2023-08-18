import { EventContext, EventsStore, Store } from "@jitsu/protocols/functions";
import { createFullContext, UDFWrapper } from "@jitsu/core-functions";
import { getLog } from "juava";
import { logType } from "@jitsu-internal/console/pages/api/[workspaceId]/function/run";

const log = getLog("udf_run");

type bodyType = {
  functionId: string;
  functionName: string;
  code: string;
  event: any;
  config: any;
  store: any;
  workspaceId: string;
};

export const UDFRunHandler = async (req, res) => {
  const body = req.body as bodyType;
  log.atInfo().log(`Running function: ${body?.functionId} workspace: ${body?.workspaceId}`, body);
  const logs: logType[] = [];
  try {
    const eventContext: EventContext = {
      geo: {
        country: {
          code: "US",
          isEU: false,
        },
        city: {
          name: "New York",
        },
        region: {
          code: "NY",
        },
        location: {
          latitude: 40.6808,
          longitude: -73.9701,
        },
        postalCode: {
          code: "11238",
        },
      },
      headers: {},
      source: {
        id: "functionsDebugger-streamId",
      },
      destination: {
        id: "functionsDebugger-destinationId",
        type: "clickhouse",
        updatedAt: new Date(),
        hash: "hash",
      },
      connection: {
        id: "functionsDebugger",
      },
    };

    const store: Store = {
      get: async (key: string) => {
        return body.store[key];
      },
      set: async (key: string, obj: any) => {
        body.store[key] = obj;
      },
      del: async (key: string) => {
        delete body.store[key];
      },
    };
    const eventsStore: EventsStore = {
      log(connectionId: string, error: boolean, msg: Record<string, any>) {
        switch (msg.type) {
          case "log-info":
          case "log-warn":
          case "log-debug":
          case "log-error":
            logs.push({
              message:
                msg.message?.text +
                (Array.isArray(msg.message?.args) && msg.message.args.length > 0
                  ? `, ${msg.message?.args.join(",")}`
                  : ""),
              level: msg.type.replace("log-", ""),
              timestamp: new Date(),
              type: "log",
            });
            break;
          case "http-request":
            let statusText;
            if (msg.error) {
              statusText = `${msg.error}`;
            } else {
              statusText = `${msg.statusText ?? ""}${msg.status ? `(${msg.status})` : ""}`;
            }
            logs.push({
              message: `${msg.method} ${msg.url} :: ${statusText}`,
              level: msg.error ? "error" : "info",
              timestamp: new Date(),
              type: "http",
              data: {
                body: msg.body,
                headers: msg.headers,
                response: msg.response,
              },
            });
        }
      },
    };
    const ctx = createFullContext(body.functionId, eventsStore, store, eventContext, {}, body.config);
    const wrapper = UDFWrapper(body.functionId, body.functionName, body.code);
    const result = await wrapper.userFunction(body.event, ctx);
    res.json({
      error: "",
      result: result || body.event,
      store: body.store,
      logs,
    });
  } catch (e) {
    log.atError().withCause(e).log(`Error running function: ${body?.functionId} workspace: ${body?.workspaceId}`);
    res.json({
      error: `${e}`,
      result: {},
      store: body?.store ?? {},
      logs,
    });
  }
};
