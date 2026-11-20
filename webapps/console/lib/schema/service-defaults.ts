import Ajv, { ValidateFunction } from "ajv";
import isPlainObject from "lodash/isPlainObject";
import { db } from "../server/db";
import { getServerLog } from "../server/log";
import { assertTargetsUnchanged, UnmaskOptions } from "./secrets";

const log = getServerLog("service-defaults");

// JITSU-284: a service saved or tested with masks in its credentials is sent by an editor that could not add the
// connector spec's defaults to them: it checks a copy, because it does not know the stored values, and a conditional
// schema reads the mask where the stored value was and takes the wrong branch. Once the masks are replaced by the stored
// values the branch is the right one, so the defaults are added here.

const OPTIONS = { allErrors: true, strictSchema: false, useDefaults: true, allowUnionTypes: true };
const MAX_COMPILED = 200;
// Compiling a big spec is slow, so the validator is kept per package@version, as long as the spec is the same
const compiled = new Map<string, { spec: string; validate: ValidateFunction }>();

async function usableSpec(packageName: string, version: string): Promise<any | undefined> {
  const row = await db.prisma().source_spec.findUnique({
    where: { package_version: { package: packageName, version } },
  });
  const spec = (row?.specs as any)?.connectionSpecification;
  return isPlainObject(spec?.properties) ? spec : undefined;
}

function validatorFor(key: string, spec: any): ValidateFunction {
  const text = JSON.stringify(spec);
  const cached = compiled.get(key);
  if (cached && cached.spec === text) {
    return cached.validate;
  }
  const schema = JSON.parse(text);
  // Ajv does not know the identifiers of `https://` schemas, the editor rewrites them the same way
  if (typeof schema.$schema === "string") {
    schema.$schema = schema.$schema.replace("https://", "http://");
  }
  const validate = new Ajv(OPTIONS).compile(schema);
  if (compiled.size >= MAX_COMPILED) {
    compiled.delete(compiled.keys().next().value as string);
  }
  compiled.set(key, { spec: text, validate });
  return validate;
}

/**
 * The service with the defaults of its connector spec added to `credentials`. It only adds: a value that does not fit
 * the spec is left as it is (the connector reports it), and with no usable spec, or if the spec cannot be compiled, the
 * service comes back unchanged. The service passed in is not modified.
 */
export async function withServiceSpecDefaults<T extends { package?: any; version?: any; credentials?: any }>(
  service: T
): Promise<T> {
  if (!service || typeof service.package !== "string" || typeof service.version !== "string") {
    return service;
  }
  if (!isPlainObject(service.credentials)) {
    return service;
  }
  try {
    const spec = await usableSpec(service.package, service.version);
    if (!spec) {
      return service;
    }
    const validate = validatorFor(`${service.package}@${service.version}`, spec);
    const credentials = JSON.parse(JSON.stringify(service.credentials));
    validate(credentials);
    return { ...service, credentials };
  } catch (error) {
    // no credential value is logged: only the package and the error of the schema compiler or the lookup
    log.atWarn().withCause(error).log(`Cannot add the spec defaults of ${service.package}@${service.version}`);
    return service;
  }
}

/**
 * What the unmasking of a saved service may assume. With a usable connector spec only the fields it marks as secret are
 * masked, so every other value in the submitted config is one the caller could read, and a list that holds masks may be
 * compared with the stored one. A lookup that fails counts as no spec. Any other type has nothing to assume.
 */
export async function serviceUnmaskOptions(type: string, stored: any): Promise<UnmaskOptions> {
  if (type !== "service" || typeof stored?.package !== "string" || typeof stored?.version !== "string") {
    return {};
  }
  try {
    return { visibleValuesPublic: !!(await usableSpec(stored.package, stored.version)) };
  } catch {
    return {};
  }
}

/**
 * Only a service has a connector spec: any other type comes back as it is. `comparedWith` is the stored service: a
 * default must not point a connection target somewhere else than the stored one, because the stored secrets go with
 * it. A default is compared with the stored service's own defaults, so a field the stored service leaves to the spec is
 * the same on both sides.
 */
export async function applyServiceSpecDefaults<T>(type: string, object: T, comparedWith?: any): Promise<T> {
  if (type !== "service") {
    return object;
  }
  const withDefaults = await withServiceSpecDefaults(object as any);
  if (withDefaults !== object && comparedWith) {
    assertTargetsUnchanged(withDefaults, await withServiceSpecDefaults(comparedWith));
  }
  return withDefaults as T;
}
