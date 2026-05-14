import { AuthInfo } from "./auth-file";

export type ApiRequest = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
};

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export class ApiClient {
  constructor(private auth: AuthInfo) {}

  url(path: string, query?: ApiRequest["query"]): string {
    const base = this.auth.host;
    const p = path.startsWith("/") ? path : `/${path}`;
    if (!query) return `${base}${p}`;
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    return qs ? `${base}${p}?${qs}` : `${base}${p}`;
  }

  async request<T = unknown>(req: ApiRequest): Promise<T> {
    const method = req.method ?? "GET";
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.auth.apikey}`,
    };
    let body: string | undefined;
    if (req.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(req.body);
    }
    const res = await fetch(this.url(req.path, req.query), { method, headers, body });
    const text = await res.text();
    let parsed: unknown = text;
    if (text && res.headers.get("content-type")?.includes("application/json")) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // fall through with raw text
      }
    }
    if (!res.ok) {
      const msg =
        (parsed && typeof parsed === "object" && "message" in (parsed as any)
          ? String((parsed as any).message)
          : undefined) ?? `HTTP ${res.status} ${method} ${req.path}`;
      throw new ApiError(res.status, msg, parsed);
    }
    return parsed as T;
  }
}
