import { createClient } from "@clickhouse/client";
import { getLog, getSingleton, newError, parseNumber, Singleton } from "juava";
import { EntityStore } from "../../lib/entity-store";
import { EnrichedConnectionConfig } from "../../lib/config-types";
import { StoreMetrics } from "./index";
import { Parser } from "node-sql-parser";
const parser = new Parser();

const log = getLog("warehouseStore");

const warehouses: Record<string, Singleton<any>> = {};

const warehouseTimeoutMs = parseNumber(process.env.WAREHOUSE_TIMEOUT_MS, 1000);

interface WarehouseStore {
  query: (query: string, params?: Record<string, any>) => Promise<any[]>;
  close?: () => void;
}

export async function warehouseQuery(
  workspaceId: string,
  connStore: EntityStore<EnrichedConnectionConfig>,
  conId: string,
  query: string,
  params: Record<string, any>,
  storeMetrics?: StoreMetrics
) {
  const con = connStore.getObject(conId);
  if (!con || con.workspaceId !== workspaceId) {
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
        const cl = getClickhouseWarehouse(workspaceId, conId, con.credentials, storeMetrics);
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

const getClickhouseWarehouse = (
  workspaceId: string,
  conId: string,
  cred: any,
  storeMetrics?: StoreMetrics
): WarehouseStore => {
  const client = getClickhouseClient(cred);
  return {
    query: async (query: string, query_params?: Record<string, any>) => {
      let status = "success";
      let table = "_unknown_";
      const start = Date.now();
      try {
        const splits = (parser.tableList(query)[0] || "_unknown_").split("::");
        table = splits[splits.length - 1];
      } catch (e) {}
      try {
        //replace named parameters in query (like :paramName or @param_name) with clickhouse positional parameters (like {paramName: Int32})
        query = query.replace(/[:@](\w+)/g, (match, paramName) => {
          let t = "String";
          const param = query_params?.[paramName];
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
              } else if (Array.isArray(param)) {
                query_params![paramName] = JSON.stringify(param);
              }
          }
          return `{${paramName}: ${t}}`;
        });
        const res = await client.query({
          query,
          query_params,
          abort_signal: AbortSignal.timeout(warehouseTimeoutMs),
          format: "JSONEachRow",
        });
        return res.json();
      } catch (e: any) {
        if (e.message === "The user aborted a request.") {
          status = "timeout";
          e = new Error(`Query execution exceeded ${warehouseTimeoutMs}ms timeout. Aborted.`);
        } else {
          status = "error";
        }
        throw e;
      } finally {
        const ms = Date.now() - start;
        if (storeMetrics) {
          storeMetrics.warehouseStatus(conId, table, status, ms);
        }
        log
          .atInfo()
          .log(
            `[${conId}] query: ${query} params: ${JSON.stringify(
              query_params
            )} table: ${table} status: ${status} ms: ${ms}`
          );
      }
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
