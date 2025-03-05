import { createClient } from "@clickhouse/client";
import { getLog, getSingleton, newError, Singleton } from "juava";
import { EntityStore } from "../../lib/entity-store";
import { EnrichedConnectionConfig } from "../../lib/config-types";

const log = getLog("warehouseStore");

const warehouses: Record<string, Singleton<any>> = {};

interface WarehouseStore {
  query: (query: string, ...params: any) => Promise<any>;
  close?: () => void;
}

export async function warehouseQuery(
  connStore: EntityStore<EnrichedConnectionConfig>,
  conId: string,
  query: string,
  params: Record<string, any>
) {
  const con = connStore.getObject(conId);
  if (!con) {
    throw newError(`Warehouse with id ${conId} not found`);
  }
  if (con.type !== "clickhouse") {
    throw newError(`Only Clickhouse warehouse is currently supported`);
  }
  let singleTon = warehouses[`${con.id}-${con.credentialsHash}`];
  if (!singleTon) {
    singleTon = getSingleton(
      `warehouse-${con.id}-${con.credentialsHash}`,
      () => {
        log.atInfo().log(`Connecting to ClickHouse warehouse of con: ${con.id}`);
        const cl = getClickhouseWarehouse(con.credentials);
        log.atInfo().log(`Connected successfully ClickHouse warehouse of con: ${con.id}`);
        return cl;
      },
      {
        optional: true,
        ttlSec: 60 * 60,
        cleanupFunc: async client => {
          log.atInfo().log(`Closing ClickHouse warehouse of con: ${con.id}`);
          client.close?.();
        },
      }
    );
    warehouses[`${con.id}-${con.credentialsHash}`] = singleTon;
  }
  const wh = await singleTon.waitInit();
  return await wh.query(query, params);
}

const getClickhouseWarehouse = (cred: any): WarehouseStore => {
  const client = getClickhouseClient(cred);
  return {
    query: async (query: string, query_params: Record<string, any>) => {
      //replace named parameters in query (like :paramName or @param_name) with clickhouse positional parameters (like {paramName: Int32})
      query = query.replace(/[:@](\w+)/g, (match, paramName) => {
        let t = "String";
        const param = query_params[paramName];
        switch (typeof param) {
          case "number":
            if (Number.isInteger(param)) {
              t = "Int64";
            } else {
              t = "Float64";
            }
            break;
          case "boolean":
            t = "UInt8";
            break;
          case "undefined":
            throw newError(`Parameter ${paramName} is not provided`);
          default:
            if (param == null) {
              t = "Nullable(String)";
            }
        }
        return `{${paramName}: ${t}}`;
      });
      log.atInfo().log(`Executing query: ${query} with params: ${JSON.stringify(query_params)}`);

      const res = await client.query({
        query,
        query_params,
        format: "JSONEachRow",
      });
      return res.json();
    },
    close: async () => {
      await client.close();
    },
  };
};

const getClickhouseClient = (cred: any) => {
  let [host, port] = cred.hosts[0].split(":");
  switch (cred.protocol) {
    case "http":
      port = port || "8123";
      break;
    case "https":
      port = port || "8443";
      break;
    default:
      port = "8443";
  }
  const url = `https://${host}:${port}/`;
  log.atDebug().log(`Connecting to ${url} with ${cred.username}`);
  return createClient({
    url: url,
    database: cred.database,
    username: cred.username,
    password: cred.password,
  });
};
