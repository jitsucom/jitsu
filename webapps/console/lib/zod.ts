import { z, ZodSafeParseResult, ZodSchema } from "zod";

/**
 * The `.describe()` text of a schema, found through optional / nullable / default / transform wrappers.
 *
 * zod 3 copied a description onto every wrapper (`z.string().describe("x").optional().description === "x"`). zod 4 keeps
 * it on the schema that was described, so the outer schema of `credentials.partial({ a: true })` reports none and
 * labels and hints taken from it disappear.
 */
export function getZodDescription(schema: z.ZodType): string | undefined {
  for (let cur: z.ZodType | undefined = schema; cur; ) {
    if (cur.description) {
      return cur.description;
    }
    if (cur instanceof z.ZodPipe) {
      cur = (cur.in instanceof z.ZodTransform ? cur.out : cur.in) as z.ZodType;
    } else {
      cur = (cur.def as { innerType?: z.ZodType }).innerType;
    }
  }
  return undefined;
}

const isoRegex = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*)?)((-(\d{2}):(\d{2})|Z)?)$/;

function tryParseISO8601(date: any): Date | undefined {
  if (typeof date !== "string" || !isoRegex.test(date)) {
    return undefined;
  }
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    return undefined;
  }
  return d;
}

export function safeParseWithDate<T>(schema: ZodSchema<T>, input: any): ZodSafeParseResult<T> {
  return schema.safeParse(
    transformObjectLeaves(input, (kev, val) => {
      const date = tryParseISO8601(val);
      return date ? date : val;
    })
  );
}

export function transformObjectLeaves(obj: any, proc: (key: keyof any, value: any) => any) {
  if (Array.isArray(obj)) {
    return obj.map(v => transformObjectLeaves(v, proc));
  }
  if (obj !== null && typeof obj === "object") {
    const newObj: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "object") {
        newObj[k] = transformObjectLeaves(v, proc);
      } else {
        newObj[k] = proc(k, v);
      }
    }
    return newObj;
  }
  return obj;
}

const undefinedMagicValue = "__*$undef$*__";

export function prepareZodObjectForSerialization(obj: any) {
  return transformObjectLeaves(obj, (key, val) => (val === undefined ? undefinedMagicValue : val));
}

export function prepareZodObjectForDeserialization(obj: any) {
  return transformObjectLeaves(obj, (key, val) => (val === undefinedMagicValue ? undefined : val));
}

export function createDisplayName(name: string) {
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/([-_][a-z]|^[a-z])/g, group => group.toUpperCase().replace("-", " ").replace("_", " "));
}
