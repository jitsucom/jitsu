import { MASKED_SECRET } from "./destinations";

/** The part of an Ajv error the editor needs to tell which field, and which part of the schema, it is about */
export type FieldError = { instancePath?: string; schemaPath?: string; keyword?: string };

// JITSU-284: while a connector spec is missing, every credential value of a service reaches the editor as the mask, a
// string, even a number or a boolean (a port). When the spec arrives later, the editor checks those credentials against
// it, and the mask fails `type: integer` before the server had a chance to put the stored value back.
// A field that still holds the mask is not an input the user has to fix: it stands for the stored value.

function pointerParts(pointer: string): string[] {
  return pointer
    .split("/")
    .slice(1)
    .map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function valueAtPointer(root: any, pointer: string): unknown {
  let node = root;
  for (const part of pointerParts(pointer)) {
    if (node === null || typeof node !== "object" || !Object.prototype.hasOwnProperty.call(node, part)) {
      return undefined;
    }
    node = node[part];
  }
  return node;
}

/** The node of the schema an Ajv `schemaPath` (`#/properties/a/oneOf`) points at, or undefined when it cannot be followed */
function schemaNodeAt(schema: any, schemaPath: string): unknown {
  if (!schemaPath.startsWith("#/")) {
    return undefined;
  }
  let node = schema;
  for (const part of pointerParts(schemaPath.slice(1))) {
    if (node === null || typeof node !== "object" || !Object.prototype.hasOwnProperty.call(node, part)) {
      return undefined;
    }
    node = node[part];
  }
  return node;
}

/** The keys that every option of a `oneOf` fixes to one value: the field that says which option a value is */
function discriminatorKeys(options: any[]): string[] {
  const counts = new Map<string, number>();
  for (const option of options) {
    for (const [key, property] of Object.entries<any>(option?.properties ?? {})) {
      if (property?.const !== undefined || property?.enum?.length === 1) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return [...counts].filter(([, count]) => count === options.length).map(([key]) => key);
}

/**
 * The groups (a `oneOf` or `anyOf` and the object it was checked against) whose discriminator still holds the mask. No
 * option can match it, but it says nothing about the saved option either: the group stands for the saved values.
 */
function maskedChoiceGroups(
  errors: FieldError[],
  credentials: any,
  schema: any
): { instancePath: string; schemaPath: string }[] {
  if (schema === undefined) {
    return [];
  }
  const groups: { instancePath: string; schemaPath: string }[] = [];
  for (const error of errors) {
    if ((error.keyword !== "oneOf" && error.keyword !== "anyOf") || error.schemaPath === undefined) {
      continue;
    }
    const options = schemaNodeAt(schema, error.schemaPath);
    const value: any = valueAtPointer(credentials, error.instancePath ?? "");
    if (
      Array.isArray(options) &&
      value !== null &&
      typeof value === "object" &&
      discriminatorKeys(options).some(
        key => Object.prototype.hasOwnProperty.call(value, key) && value[key] === MASKED_SECRET
      )
    ) {
      groups.push({ instancePath: error.instancePath ?? "", schemaPath: error.schemaPath });
    }
  }
  return groups;
}

/**
 * The errors that are not about a field holding the mask, nor about a choice (`oneOf`) whose discriminator holds it.
 * An error about the whole object is always kept. The compiled `schema` is needed only to find those choices.
 */
export function withoutMaskedFieldErrors<T extends FieldError>(
  errors: T[] | null | undefined,
  credentials: any,
  schema?: any
): T[] {
  const all = errors ?? [];
  const groups = maskedChoiceGroups(all, credentials, schema);
  return all.filter(error => {
    const pointer = error.instancePath ?? "";
    if (groups.some(g => pointer.startsWith(g.instancePath) && (error.schemaPath ?? "").startsWith(g.schemaPath))) {
      return false;
    }
    return pointer === "" || valueAtPointer(credentials, pointer) !== MASKED_SECRET;
  });
}

function hasMask(value: any): boolean {
  if (value === MASKED_SECRET) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasMask);
  }
  return value !== null && typeof value === "object" && Object.values(value).some(hasMask);
}

/**
 * Checks credentials with a compiled Ajv validator and returns the errors that are not about a masked field.
 * The editor's Ajv inserts schema defaults into what it checks, and that is what gets submitted. With masks in it, a
 * conditional schema reads the mask where the stored value was (`mode` masked, so `if mode is manual` is false) and
 * inserts the defaults of the wrong branch, which the server then keeps next to the restored value. So credentials that
 * hold a mask are checked as a copy and the submitted object is left alone.
 */
export function validateKeepingMasks(
  validate: { (data: any): boolean; errors?: (FieldError & { message?: string })[] | null; schema?: any },
  credentials: any
): (FieldError & { message?: string })[] {
  const target = hasMask(credentials) ? JSON.parse(JSON.stringify(credentials)) : credentials;
  return validate(target) ? [] : withoutMaskedFieldErrors(validate.errors, target, validate.schema);
}
