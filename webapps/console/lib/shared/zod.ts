import { ZodError, ZodType } from "zod";

export type ZodErrorInfo = {
  object: any;
  zodError: ZodError;
  zodType: any;
};

export class ExtendedZodError extends Error {
  public info: ZodErrorInfo;

  constructor(info: ZodErrorInfo) {
    super(JSON.stringify(info));
    this.info = info;
  }
}

export function zParse<T>(z: ZodType<T>, obj: any): T {
  const res = z.safeParse(obj);
  if (res.success) {
    return res.data;
  } else {
    throw new ExtendedZodError({
      object: obj,
      zodError: res.error,
      zodType: z.description,
    });
  }
}
