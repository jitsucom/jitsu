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

/** Whether `pointer` is `base` or inside it: `/rows/10` is not inside `/rows/1` */
function isWithin(pointer: string, base: string): boolean {
  return base === "" || pointer === base || pointer.startsWith(base + "/");
}

// The errors Ajv puts on the object of a choice for what a masked value stands for (the discriminator and the fields a
// mode requires). Any other keyword there is about what the user supplied: `additionalProperties` says an option does
// not take a field that was given. `if` is the report of a `then` or `else` that did not hold: a mask can send the
// condition to its other side
const OWN_OBJECT_KEYWORDS = new Set(["required", "const", "enum", "oneOf", "anyOf", "if"]);

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

type ChoiceGroup = { instancePath: string; schemaPath: string; satisfied: boolean };

/**
 * The groups (a `oneOf` or `anyOf` and the object it was checked against) whose discriminator still holds the mask. No
 * option can match it, but it says nothing about the saved option either: the group stands for the saved values.
 * Ajv reports the errors of every option, so a value can fit the saved option and still fail another one (a port range
 * of each mode). The group is `satisfied` when some option has no error besides the masked values and the group's own
 * object: then none of its errors is the user's to fix. When no option fits, a typed field is wrong whatever the saved
 * option is.
 */
function maskedChoiceGroups(errors: FieldError[], credentials: any, schema: any): ChoiceGroup[] {
  if (schema === undefined) {
    return [];
  }
  const groups: ChoiceGroup[] = [];
  for (const error of errors) {
    if ((error.keyword !== "oneOf" && error.keyword !== "anyOf") || error.schemaPath === undefined) {
      continue;
    }
    const options = schemaNodeAt(schema, error.schemaPath);
    const instancePath = error.instancePath ?? "";
    const value: any = valueAtPointer(credentials, instancePath);
    if (
      !Array.isArray(options) ||
      value === null ||
      typeof value !== "object" ||
      !discriminatorKeys(options).some(
        key => Object.prototype.hasOwnProperty.call(value, key) && value[key] === MASKED_SECRET
      )
    ) {
      continue;
    }
    const schemaPath = error.schemaPath;
    const satisfied = options.some((_option, i) =>
      errors
        .filter(
          e => (e.schemaPath ?? "").startsWith(`${schemaPath}/${i}/`) && isWithin(e.instancePath ?? "", instancePath)
        )
        .every(e =>
          (e.instancePath ?? "") === instancePath
            ? OWN_OBJECT_KEYWORDS.has(e.keyword ?? "")
            : valueAtPointer(credentials, e.instancePath ?? "") === MASKED_SECRET
        )
    );
    groups.push({ instancePath, schemaPath, satisfied });
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
    const schemaPath = error.schemaPath ?? "";
    const group = groups.find(
      g =>
        isWithin(pointer, g.instancePath) && (schemaPath === g.schemaPath || schemaPath.startsWith(`${g.schemaPath}/`))
    );
    if (group) {
      // about the choice's own object ("no option matches", "option N misses a field"): nothing to fix. About a field
      // deeper in it: the user's to fix only when no option accepts the values
      if (pointer === group.instancePath || group.satisfied) {
        return false;
      }
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
