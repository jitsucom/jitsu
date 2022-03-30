export type CookieOpts = {
  maxAge?: number;
  domain?: string;
  path?: string;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None" | true;
};

export function serializeCookie(name, val, opt: CookieOpts = {}) {
  let enc = encodeURIComponent;
  const value = enc(val);
  let str = name + "=" + value;
  str += "; Path=" + (opt.path ?? "/")
  if (opt.maxAge) {
    str += "; Max-Age=" + Math.floor(opt.maxAge);
  }
  if (opt.domain) {
    str += "; Domain=" + opt.domain;
  }
  if (opt.expires) {
    str += "; Expires=" + opt.expires.toUTCString();
  }
  if (opt.httpOnly) {
    str += "; HttpOnly";
  }
  if (opt.secure) {
    str += "; Secure";
  }
  if (opt.sameSite) {
    const sameSite =
      typeof opt.sameSite === "string"
        ? opt.sameSite.toLowerCase()
        : opt.sameSite;

    switch (sameSite) {
      case true:
        str += "; SameSite=Strict";
        break;
      case "lax":
        str += "; SameSite=Lax";
        break;
      case "strict":
        str += "; SameSite=Strict";
        break;
      case "none":
        str += "; SameSite=None";
        break;
      default:
        throw new TypeError("option sameSite is invalid");
    }
  }

  return str;
}
