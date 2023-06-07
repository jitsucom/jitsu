import { NextApiRequest, NextApiResponse } from "next";
import { auth } from "../../lib/auth";
import { assertTrue, getLog, randomId, requireDefined } from "juava";
import { withErrorHandler } from "../../lib/error-handler";
import { clickhouse, store } from "../../lib/services";

export const log = getLog("provision-db");

export type Credentials = {
  username: string;
  database: string;
  password: string;
  cluster: string;
};
const clickhouseClusterName = process.env.CLICKHOUSE_CLUSTER_NAME || "jitsu_cluster";

async function createDb(name: string, cluster: string): Promise<string> {
  let nameCounter = 0;
  while (true) {
    const currentName = nameCounter === 0 ? name : `${name}${nameCounter}`;
    const resultSet = await clickhouse().query({
      query: `select count(*) as cnt
              from system.databases
              where name = '${currentName}'`,
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    });
    const result = await resultSet.json();
    const cnt = (result as any).data[0].cnt;
    if (cnt === "0") {
      const res = await clickhouse()
        .query({ query: `CREATE DATABASE ${currentName} ON CLUSTER ${cluster}` })
        .then(result => result.text());
      log.atInfo().log(`Database ${currentName} created`, res);
      return currentName;
    } else {
      log
        .atDebug()
        .log(`Database ${currentName} already exists. Trying another name. Response: ${JSON.stringify(result)}`);
      nameCounter++;
    }
  }
}

async function createUser(name: string, password: string, dbName: string, cluster: string): Promise<string> {
  let nameCounter = 0;
  while (true) {
    const currentName = nameCounter === 0 ? name : `${name}${nameCounter}`;
    const resultSet = await clickhouse().query({
      query: `select count(*) as cnt
              from system.users
              where name = '${currentName}'`,
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    });
    const result = await resultSet.json();
    const cnt = (result as any).data[0].cnt;
    if (cnt === "0") {
      const query = `CREATE USER ${currentName} ON CLUSTER ${cluster} IDENTIFIED WITH sha256_password BY '${password}' DEFAULT DATABASE ${dbName}`;
      log.atDebug().log(`Creating user ${name} with query: ${query}`);
      await clickhouse().exec({ query });
      log.atInfo().log(`User ${currentName} created`);
      const grantQuery = `GRANT ON CLUSTER ${cluster} ALL ON ${dbName}.* TO ${currentName}`;
      log.atDebug().log(`Granting db privileges to user ${name} with query: ${query}`);
      await clickhouse().exec({ query: grantQuery });
      log.atInfo().log(`Privileges granted to user ${currentName} on db ${dbName}`);
      return currentName;
    } else {
      log.atDebug().log(`User ${currentName} already exists. Trying another name. Response: ${JSON.stringify(result)}`);
      nameCounter++;
    }
  }
}

/**
 * Function accepts desired credentials and returns the actual credentials that were used
 * for creating a database. It might be slightly different if database name was already taken.
 */
async function createAccount(credentials: Credentials): Promise<Credentials> {
  await clickhouse.waitInit();
  const database = await createDb(credentials.database, credentials.cluster);
  return {
    username: await createUser(credentials.username, credentials.password, database, credentials.cluster),
    database,
    password: credentials.password,
    cluster: credentials.cluster,
  };
}

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  let chHosts: string[] = [];
  if (process.env.CLICKHOUSE_HOSTS) {
    chHosts = process.env.CLICKHOUSE_HOSTS.split(",");
  } else {
    chHosts.push(
      new URL(requireDefined(process.env.CLICKHOUSE_URL, `CLICKHOUSE_URL or CLICKHOUSE_HOSTS must be defined`)).hostname
    );
  }
  await store.waitInit();
  const claims = await auth(req, res);
  if (!claims) {
    return;
  }
  const workspaceId = requireDefined(req.query.workspaceId as string, `?workspaceId= is required. Query: ${req.query}`);
  const slug = requireDefined(req.query.slug as string, `?slug= is required`);

  assertTrue(
    claims.type === "admin" || (claims.type === "user" && claims.workspaceId === workspaceId),
    `Token can't access workspace ${workspaceId}`
  );
  const credentials = await store().getTable("provisioned-db").get(workspaceId);
  if (credentials) {
    return res.status(200).json({
      ...credentials,
      protocol: "clickhouse-secure",
      hosts: chHosts,
    });
  }
  const dbCredentials = await createAccount({
    username: slug.replace("-", "_"),
    database: slug.replace("-", "_"),
    password: randomId(24),
    cluster: clickhouseClusterName,
  });
  await store().getTable("provisioned-db").put(workspaceId, dbCredentials);
  return {
    ...dbCredentials,
    protocol: "clickhouse-secure",
    hosts: chHosts,
  };
};
export default withErrorHandler(handler);
