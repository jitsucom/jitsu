import { MASKED_SECRET } from "./destinations";

/** The part of an Ajv error the editor needs to tell which field it is about */
export type FieldError = { instancePath?: string };

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

/** The errors that are not about a field holding the mask. An error about the whole object is always kept. */
export function withoutMaskedFieldErrors<T extends FieldError>(errors: T[] | null | undefined, credentials: any): T[] {
  return (errors ?? []).filter(error => {
    const pointer = error.instancePath ?? "";
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
  validate: { (data: any): boolean; errors?: (FieldError & { message?: string })[] | null },
  credentials: any
): (FieldError & { message?: string })[] {
  const target = hasMask(credentials) ? JSON.parse(JSON.stringify(credentials)) : credentials;
  return validate(target) ? [] : withoutMaskedFieldErrors(validate.errors, target);
}
