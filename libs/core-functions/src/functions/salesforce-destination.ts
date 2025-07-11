import { FullContext, JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { SalesforceCredentials } from "../meta";
import omit from "lodash/omit";
import NodeCache from "node-cache";
import { getOauthCreds } from "./lib/oauth";
import { z } from "zod";
import zlib from "zlib";

const API_VERSION = "v64.0"; // Update this to the latest Salesforce API version if needed

const credCache = new NodeCache({ stdTTL: 800, checkperiod: 30, useClones: false });
const sobjectCacheTTL = 3600; // 1 hour
const sobjectCache = new NodeCache({ stdTTL: sobjectCacheTTL, checkperiod: 60, useClones: false });
const sobjectMetaRefreshPeriodMs = 1000 * 60 * 10; // 10 minutes

const Creds = z.object({
  instance_url: z.string(),
  access_token: z.string(),
});

type Creds = z.infer<typeof Creds>;

type SalesforcePropertyPermissions = "u" | "c" | "f" | "" | "uc" | "uf" | "cf" | "ucf" | "ucr" | "cfr" | "ucfr";

type Sobject = {
  name: string;
  properties: Record<string, SalesforcePropertyPermissions>;
  lastModifiedDate: string;
  lastChecked: Date;
};

const SalesforceEnvelope = z.object({
  SALESFORCE_OPERATION: z.enum(["insert", "update", "upsert", "delete"]).default("insert"), // Default to "insert" if not specified
  SALESFORCE_SOBJECT: z.string().optional(),
  SALESFORCE_MATCHERS_OPERATOR: z.enum(["or", "and", "OR", "AND"]).default("OR"), // Optional, defaults to "OR"
  SALESFORCE_MATCHERS: z.record(z.any()).optional(),
  SALESFORCE_PAYLOAD: z.record(z.any()).optional(),
});

type SalesforceEnvelope = z.infer<typeof SalesforceEnvelope>;

function lead(event: AnalyticsServerEvent, operation: SalesforceEnvelope["SALESFORCE_OPERATION"]): any {
  const knownProps = [
    "company",
    "last_name",
    "first_name",
    "email",
    "city",
    "state",
    "country",
    "postal_code",
    "street",
  ];
  const traits = event.traits || {};
  const properties = event.properties || {};
  const res = {
    Company: traits.company || properties.company,
    LastName: traits.last_name || properties.last_name,
    FirstName: traits.first_name || properties.first_name,
    Email: traits.email || properties.email,
    City: traits.address?.["city"] || properties.address?.["city"],
    State: traits.address?.["state"] || properties.address?.["state"],
    Country: traits.address?.["country"] || properties.address?.["country"],
    PostalCode: traits.address?.["postal_code"] || properties.address?.["postal_code"],
    Street: traits.address?.["street"] || properties.address?.["street"],
    ...omit(properties, knownProps),
    ...omit(traits, knownProps),
  };
  if (operation === "insert") {
    if (!res.LastName) {
      throw new Error("'Lead' object requires 'LastName' property");
    }
    if (!res.Company) {
      throw new Error("'Lead' object requires 'Company' property");
    }
  }
  return res;
}

function account(event: AnalyticsServerEvent, operation: SalesforceEnvelope["SALESFORCE_OPERATION"]): any {
  const knownProps = [
    "name",
    "employees",
    "city",
    "state",
    "country",
    "postal_code",
    "street",
    "phone",
    "description",
    "website",
  ];
  const traits = event.traits || {};
  const properties = event.properties || {};
  const res = {
    Name: traits.name,
    AccountNumber: event.groupId,
    NumberOfEmployees: traits.employees || properties.employees,
    BillingCity: traits.address?.["city"] || properties.address?.["city"],
    BillingState: traits.address?.["state"] || properties.address?.["state"],
    BillingCountry: traits.address?.["country"] || properties.address?.["country"],
    BillingPostalCode: traits.address?.["postal_code"] || properties.address?.["postal_code"],
    BillingStreet: traits.address?.["street"] || properties.address?.["street"],
    Phone: traits.phone || properties.phone,
    Description: traits.description || properties.description,
    Website: traits.website || properties.website,
    ...omit(properties, knownProps),
    ...omit(traits, knownProps),
  };
  if (operation === "insert") {
    if (!res.Name) {
      throw new Error("'Account' object requires 'Name' property");
    }
  }
  return res;
}

function contact(event: AnalyticsServerEvent, operation: SalesforceEnvelope["SALESFORCE_OPERATION"]): any {
  const knownProps = ["last_name", "first_name", "email", "city", "state", "country", "postal_code", "street"];
  const contextTraits = event.context?.traits || {};
  const traits = event.traits || {};
  const properties = event.properties || {};
  const res = {
    LastName: traits.last_name || properties.last_name,
    FirstName: traits.first_name || properties.first_name,
    Email: traits.email || properties.email,
    MailingCity: traits.address?.["city"] || properties.address?.["city"],
    MailingState: traits.address?.["state"] || properties.address?.["state"],
    MailingCountry: traits.address?.["country"] || properties.address?.["country"],
    MailingPostalCode: traits.address?.["postal_code"] || properties.address?.["postal_code"],
    MailingStreet: traits.address?.["street"] || properties.address?.["street"],
    ...omit(contextTraits, knownProps),
    ...omit(properties, knownProps),
    ...omit(traits, knownProps),
  };
  if (operation === "insert") {
    if (!res.LastName) {
      throw new Error("'Contact' object requires 'LastName' property");
    }
  }
  return res;
}

function defaultMapping(event: AnalyticsServerEvent, operation: SalesforceEnvelope["SALESFORCE_OPERATION"]): any {
  const contextTraits = event.context?.traits || {};
  const traits = event.traits || {};
  const properties = event.properties || {};
  return {
    ...contextTraits,
    ...properties,
    ...traits,
  };
}

async function filterOutAvailableProperties(
  ctx: FullContext,
  cred: Creds,
  payload: any,
  sobject: string,
  operation: SalesforceEnvelope["SALESFORCE_OPERATION"],
  logLevel: "warn" | "info" | "debug" | "error" = "debug"
) {
  const log = ctx.log[logLevel];
  const availableProps = await availableProperties(ctx, cred, sobject);
  if (!availableProps) {
    throw new Error(`Object type '${sobject}' not found`);
  }
  // check for required properties for insert operation
  if (operation === "insert") {
    for (const [prop, mod] of Object.entries(availableProps)) {
      if (mod.includes("r") && !payload[prop]) {
        throw new Error(`'${sobject}' object requires '${prop}' property`);
      }
    }
  }
  for (const key of Object.keys(payload)) {
    const prop = availableProps?.[key];
    if (typeof prop === "undefined") {
      log(`Property '${key}' is not available in the '${sobject}' object's schema, removing from payload`);
      delete payload[key]; // Remove unavailable properties
    } else {
      if (!prop.includes("u") && operation !== "insert") {
        log(`'${sobject}' object's property '${key}' is not updateable, removing from payload`);
        delete payload[key]; // Remove properties that are not updateable for update or upsert operations
      } else if (!prop.includes("c") && operation === "insert") {
        log(`'${sobject}' object's property '${key}' is not createable, removing from payload`);
        delete payload[key]; // Remove properties that are not createable for insert operations
      }
    }
  }
}

const SalesforceDestination: JitsuFunction<AnalyticsServerEvent, SalesforceCredentials> = async (event, ctx) => {
  const { props, log } = ctx;
  if (!props.authorized) {
    throw new Error("Salesforce destination is not authorized. Please authorize destination in Jitsu UI.");
  }
  const envelope = SalesforceEnvelope.parse(event || {});
  //log.info(`Processing Salesforce event with envelope: ${JSON.stringify(envelope)}`);
  if (!envelope.SALESFORCE_SOBJECT) {
    switch (event.type) {
      case "identify":
        envelope.SALESFORCE_SOBJECT = "Lead";
        break;
      case "group":
        envelope.SALESFORCE_SOBJECT = "Account";
        break;
      default:
        throw new Error(
          `SALESFORCE_SOBJECT is not specified. And sobject cannot be determined based on event type '${event.type}'`
        );
    }
  }
  if (["update", "upsert", "delete"].includes(envelope.SALESFORCE_OPERATION)) {
    if (typeof envelope.SALESFORCE_MATCHERS !== "object" || Object.keys(envelope.SALESFORCE_MATCHERS).length === 0) {
      throw new Error(`SALESFORCE_MATCHERS is required for SALESFORCE_OPERATION '${envelope.SALESFORCE_OPERATION}'`);
    }
  }
  const updatedAtStr = ctx.destination.updatedAt?.toString();
  const cacheKey = `${ctx.destination.id}-${updatedAtStr}`;
  let cred: Creds | undefined = credCache.get(cacheKey);
  if (!cred) {
    const oauth = await getOauthCreds(props.oauthIntegrationId!, props.oauthConnectionId!);
    cred = Creds.parse(oauth.credentials.raw);
    credCache.set(cacheKey, cred);
  }

  let recordId;
  if (["update", "upsert", "delete"].includes(envelope.SALESFORCE_OPERATION)) {
    recordId = envelope.SALESFORCE_MATCHERS?.Id;
    if (!recordId) {
      // If Id is not provided, we need to look it up based on SALESFORCE_MATCHERS
      recordId = await lookupMatchers(
        ctx,
        cred,
        envelope.SALESFORCE_MATCHERS!,
        envelope.SALESFORCE_SOBJECT,
        envelope.SALESFORCE_MATCHERS_OPERATOR,
        envelope.SALESFORCE_OPERATION
      );
      if (recordId === 0) {
        if (envelope.SALESFORCE_OPERATION !== "upsert") {
          return; // No record found, nothing to update or delete
        } else {
          envelope.SALESFORCE_OPERATION = "insert"; // If upsert and no record found, change operation to insert
        }
      } else if (!recordId) {
        return;
      }
    }
  }
  if (envelope.SALESFORCE_OPERATION === "delete") {
    envelope.SALESFORCE_PAYLOAD = undefined;
  } else if (!envelope.SALESFORCE_PAYLOAD) {
    switch (envelope.SALESFORCE_SOBJECT) {
      case "Lead":
        envelope.SALESFORCE_PAYLOAD = lead(event, envelope.SALESFORCE_OPERATION);
        break;
      case "Account":
        envelope.SALESFORCE_PAYLOAD = account(event, envelope.SALESFORCE_OPERATION);
        break;
      case "Contact":
        envelope.SALESFORCE_PAYLOAD = contact(event, envelope.SALESFORCE_OPERATION);
        break;
      default:
        envelope.SALESFORCE_PAYLOAD = defaultMapping(event, envelope.SALESFORCE_OPERATION);
        break;
    }
    await filterOutAvailableProperties(
      ctx,
      cred,
      envelope.SALESFORCE_PAYLOAD!,
      envelope.SALESFORCE_SOBJECT,
      envelope.SALESFORCE_OPERATION,
      "debug"
    );
  } else {
    await filterOutAvailableProperties(
      ctx,
      cred,
      envelope.SALESFORCE_PAYLOAD!,
      envelope.SALESFORCE_SOBJECT,
      envelope.SALESFORCE_OPERATION,
      "warn"
    );
  }
  let httpMethod = "POST";
  let httpPath = `/sobjects/${envelope.SALESFORCE_SOBJECT}`;
  if (envelope.SALESFORCE_OPERATION === "update" || envelope.SALESFORCE_OPERATION === "upsert") {
    httpMethod = "PATCH";
    httpPath += "/" + recordId;
  } else if (envelope.SALESFORCE_OPERATION === "delete") {
    httpMethod = "DELETE";
    httpPath += "/" + recordId;
  }
  const slash = cred.instance_url.endsWith("/") ? "" : "/";

  const httpRequest = {
    method: httpMethod,
    path: httpPath,
    payload: envelope.SALESFORCE_PAYLOAD,
  };

  try {
    for (let i = 0; i < 2; i++) {
      const method = httpRequest.method || "POST";
      const result = await ctx.fetch(`${cred.instance_url}${slash}services/data/${API_VERSION}${httpRequest.path}`, {
        method,
        headers: {
          "Content-type": "application/json",
          "Content-Encoding": "gzip",
          Authorization: `Bearer ${cred.access_token}`,
        },
        ...(httpRequest.payload ? { body: zlib.gzipSync(JSON.stringify(httpRequest.payload)) } : {}),
      });
      if (!result.ok) {
        if (result.status === 401) {
          const oauth = await getOauthCreds(props.oauthIntegrationId!, props.oauthConnectionId!);
          cred = Creds.parse(oauth.credentials.raw);
          credCache.set(cacheKey, cred);
          if (i === 0) {
            log.info(`Retrying Salesforce ${method} ${httpRequest.path} after re-authentication`);
            continue; // Retry once after re-authentication
          }
        } else if (result.status === 400 || result.status === 404) {
          ctx.log.error(
            `Salesforce ${method} ${httpRequest.path}:${
              httpRequest.payload ? `${JSON.stringify(httpRequest.payload)} --> ` : ""
            }${result.status} ${await result.text()}`
          );
          return;
        }
        throw new Error(
          `Salesforce ${method} ${httpRequest.path}:${
            httpRequest.payload ? `${JSON.stringify(httpRequest.payload)} --> ` : ""
          }${result.status} ${await result.text()}`
        );
      } else {
        return;
      }
    }
  } catch (e: any) {
    throw new RetryError(e.message);
  }
};

// Salesforce SOQL spec requires any single quotes to be escaped.
const escapeQuotes = (value: string) => value.replace(/'/g, "\\'");

// Salesforce field names should have only characters in {a-z, A-Z, 0-9, _}.
const removeInvalidChars = (value: string) => value.replace(/[^a-zA-Z0-9_]/g, "");

// Pre-formats trait values based on datatypes for correct SOQL syntax
const typecast = (value: any) => {
  switch (typeof value) {
    case "boolean":
      return value;
    case "number":
      return value;
    case "string":
      return `'${escapeQuotes(value)}'`;
    case "object":
      if (value === null) {
        return "null"; // Salesforce SOQL allows null values
      }
    default:
      throw new Error("Unsupported datatype for record matcher traits - " + typeof value);
  }
};

const buildQuery = (
  matchers: Record<string, any>,
  sobject: string,
  soqlOperator: SalesforceEnvelope["SALESFORCE_MATCHERS_OPERATOR"]
) => {
  let soql = `SELECT Id FROM ${sobject} WHERE `;
  const entries = Object.entries(matchers);
  let i = 0;
  for (const [key, value] of entries) {
    let token = `${removeInvalidChars(key)} = ${typecast(value)}`;
    if (i < entries.length - 1) {
      token += " " + soqlOperator + " ";
    }
    soql += token;
    i += 1;
  }
  return soql;
};

const availableProperties = async (
  ctx: FullContext,
  cred: Creds,
  sobject: string
): Promise<Sobject["properties"] | undefined> => {
  try {
    const cacheKey = `${sobject}-${cred.instance_url}`;
    let sobjectData: Sobject | undefined = sobjectCache.get(cacheKey);
    if (!sobjectData || Date.now() - sobjectData.lastChecked.getTime() > sobjectMetaRefreshPeriodMs) {
      const slash = cred.instance_url.endsWith("/") ? "" : "/";
      const headers: Record<string, string> = {
        Authorization: `Bearer ${cred.access_token}`,
      };
      if (sobjectData?.lastModifiedDate) {
        headers["If-Modified-Since"] = sobjectData.lastModifiedDate;
      }
      const res = await ctx.fetch(
        `${cred.instance_url}${slash}services/data/${API_VERSION}/sobjects/${sobject}/describe`,
        {
          headers,
        }
      );
      if (res.status === 304) {
        ctx.log.debug(`Salesforce object ${sobject} description not modified, using cached data`);
        sobjectData!.lastChecked = new Date();
        return sobjectData!.properties; // Return cached properties if not modified
      } else if (res.status === 404) {
        return undefined; // Return undefined if the object type is not found
      }
      if (!res.ok) {
        throw new Error(`Failed to fetch Salesforce object description: ${res.status} ${await res.text()}`);
      }
      const data = await res.json();
      const properties = Object.fromEntries(
        data.fields.map((f: any) => [
          f.name,
          ((f.updateable ? "u" : "") +
            (f.createable ? "c" : "") +
            (f.filterable ? "f" : "") +
            (f.createable && !f.nillable && !f.defaultedOnCreate ? "r" : "")) as SalesforcePropertyPermissions,
        ])
      );
      sobjectData = {
        name: sobject,
        properties,
        lastModifiedDate: res.headers.get("Last-Modified") || "",
        lastChecked: new Date(),
      };
      sobjectCache.set(cacheKey, sobjectData);
      sobjectCache.ttl(cacheKey, sobjectCacheTTL);
      return properties;
    } else {
      //ctx.log.info(`Using cached properties for Salesforce object '${sobject}': ${JSON.stringify(sobjectData)}`);
      return sobjectData.properties;
    }
  } catch (e: any) {
    throw new RetryError(`Error during SALESFORCE_PROPERTIES lookup: ${e.message}`);
  }
};

const lookupMatchers = async (
  ctx: FullContext,
  cred: Creds,
  matchers: Record<string, any>,
  sobject: string,
  soqlOperator: SalesforceEnvelope["SALESFORCE_MATCHERS_OPERATOR"],
  operation: SalesforceEnvelope["SALESFORCE_OPERATION"]
): Promise<string | 0 | undefined> => {
  try {
    const SOQLQuery = buildQuery(matchers, sobject, soqlOperator);
    const slash = cred.instance_url.endsWith("/") ? "" : "/";

    const res = await ctx.fetch(
      `${cred.instance_url}${slash}services/data/${API_VERSION}/query/?q=${encodeURIComponent(SOQLQuery)}`,
      {
        headers: {
          Authorization: `Bearer ${cred.access_token}`,
        },
      }
    );
    if (!res.ok) {
      if (res.status === 400) {
        ctx.log.error(`SALESFORCE_MATCHERS lookup failed: ${res.status} ${await res.text()}`);
        return;
      }
      throw new Error(`lookup failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    if (!data || data.totalSize === undefined) {
      throw new Error("lookup response missing expected fields");
    }

    if (data.totalSize === 0) {
      if (operation === "upsert") {
        ctx.log.debug("No record found with given SALESFORCE_MATCHERS: " + SOQLQuery + ", proceeding with insert");
      } else {
        ctx.log.error("No record found with given SALESFORCE_MATCHERS: " + SOQLQuery);
      }
      return 0; // Return 0 to indicate no record found, which is useful for upsert operations
    }

    if (data.totalSize > 1) {
      ctx.log.error("Multiple records returned with given SALESFORCE_MATCHERS: " + SOQLQuery);
      return;
    }

    if (!data.records || !data.records[0] || !data.records[0].Id) {
      throw new Error("lookup response missing expected fields");
    }

    return data.records[0].Id;
  } catch (e: any) {
    throw new RetryError(`Error during SALESFORCE_MATCHERS lookup: ${e.message}`);
  }
};

SalesforceDestination.displayName = "salesforce-destination";

export default SalesforceDestination;
