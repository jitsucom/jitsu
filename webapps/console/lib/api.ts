import { ZodType } from "zod";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { assertDefined, checkHash, checkRawToken, getErrorMessage, requireDefined, tryJson } from "juava";
import { getServerSession, Session } from "next-auth";
import { nextAuthConfig } from "./nextauth.config";
import { SessionUser } from "./schema";
import { db } from "./server/db";
import { prepareZodObjectForDeserialization, safeParseWithDate } from "./zod";
import { ApiError } from "./shared/errors";
import { getServerLog } from "./server/log";
import { getFirebaseUser, isFirebaseEnabled } from "./server/firebase-server";
const adminServiceAccountEmail = "admin-service-account@jitsu.com";

type HandlerOpts<Req = void, Query = void, RequireAuth extends boolean = boolean> = {
  body?: Req;
  query?: Query;
  //todo: make user undefined if RequireAuth is false
  user: RequireAuth extends true ? SessionUser : SessionUser;
  req: NextApiRequest;
  res: NextApiResponse;
};
export const httpMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"] as const;
export type HttpMethodType = (typeof httpMethods)[number];

const log = getServerLog("api");

export type ApiMeta = {
  url: string;
};

export type Api = {
  [K in HttpMethodType | keyof ApiMeta]?: K extends keyof ApiMeta ? ApiMeta[K] : ApiMethod;
};

export function inferUrl(file: string) {
  return file.replace(/.*\/pages\/api/, "/api").replace(/\.ts$/, "");
}

export type ApiMethod<RequireAuth extends boolean = boolean, Res = any, Body = any, Query = any> = {
  description?: string;
  auth: RequireAuth;
  types?: {
    body?: ZodType<Body>;
    result?: ZodType<Res>;
    query?: ZodType<Query>;
  };
  // indicates that handler uses write method for outputting response content. This is useful for streaming responses.
  streaming?: boolean;
  handle: (ctx: HandlerOpts<Body, Query, RequireAuth>) => Promise<Res>;
};

function isApiError(e: any) {
  return typeof e?.responseObject === "object";
}

function getUserFromSession(session: Session): SessionUser {
  assertDefined(session.user, "Session does not have a user");
  return {
    internalId: session["internalId"] as string,
    externalUsername: session["externalUsername"] as string,
    externalId: session["externalId"] as string,
    loginProvider: session["loginProvider"] as string,
    email: session.user.email || "unknown",
    name: session.user.name || "Unknown",
    image: session.user?.image,
  };
}

function parseIfNeeded(o: any): any {
  if (typeof o === "string") {
    return JSON.parse(o);
  } else {
    return o;
  }
}

export function getAuthBearerToken(req: NextApiRequest): string | undefined {
  if (req.headers.authorization && req.headers.authorization.toLowerCase().indexOf("bearer ") === 0) {
    return req.headers.authorization.substring("bearer ".length);
  } else if (req.query?.__unsafe_token) {
    //very unsafe, but some tools we use can't set headers, so we need to allow this
    return req.query.__unsafe_token as string;
  }
  return undefined;
}

function findServiceAccount({ keyId, secret }): SessionUser | undefined {
  let tokens: string[] = [];
  let checkFunction: (token: string, secret: string) => boolean = () => false;
  if (process.env.CONSOLE_AUTH_TOKENS) {
    tokens = process.env.CONSOLE_AUTH_TOKENS.split(",");
    checkFunction = checkHash;
  } else if (process.env.CONSOLE_RAW_AUTH_TOKENS) {
    tokens = process.env.CONSOLE_RAW_AUTH_TOKENS.split(",");
    checkFunction = checkRawToken;
  }
  if (tokens.length > 0) {
    for (const tokenHashOrPlain of tokens) {
      if (checkFunction(tokenHashOrPlain, secret)) {
        return {
          internalId: adminServiceAccountEmail,
          externalUsername: adminServiceAccountEmail,
          externalId: adminServiceAccountEmail,
          loginProvider: "admin/token",
          email: adminServiceAccountEmail,
          name: adminServiceAccountEmail,
        };
      }
    }
  }
}

export async function getUser(
  res: NextApiResponse,
  req: NextApiRequest,
  checkRevoked?: boolean
): Promise<SessionUser | undefined> {
  const bearerToken = getAuthBearerToken(req);
  if (bearerToken) {
    const [keyId, secret] = bearerToken.split(":");
    const serviceAccount = findServiceAccount({ keyId, secret });
    if (serviceAccount) {
      return serviceAccount;
    }
    if (keyId && secret) {
      //auth based on an API key
      const token = await db.prisma().userApiToken.findUnique({ where: { id: keyId } });
      if (!token) {
        throw new ApiError(`Invalid API key id ${keyId}`, { keyId }, { status: 401 });
      }
      if (!checkHash(token.hash, secret)) {
        throw new ApiError(`Invalid API key secret for ${keyId}`, { keyId }, { status: 401 });
      }
      const user = requireDefined(
        await db.prisma().userProfile.findUnique({ where: { id: token.userId } }),
        `Can't find user ${token.userId} for API key ${keyId}`
      );
      await db.prisma().userApiToken.update({ where: { id: keyId }, data: { lastUsed: new Date() } });
      return {
        internalId: user.id,
        externalUsername: user.externalUsername,
        externalId: user.externalId,
        loginProvider: user.loginProvider,
        email: user.email,
        name: user.name,
      };
    }
  }

  if (isFirebaseEnabled()) {
    return await getFirebaseUser(req, checkRevoked);
  }
  const session = await getServerSession(req, res, nextAuthConfig);
  return session ? getUserFromSession(session) : undefined;
}

export function nextJsApiHandler(api: Api): NextApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const method = req.method as HttpMethodType;
    const handler = api[method];
    if (!handler) {
      res.status(405).json({ error: `${method} method not supported` });
      return;
    }
    let currentUser: SessionUser | undefined = undefined;

    try {
      //let session: Session | undefined | null = undefined;
      if (handler.auth) {
        currentUser = await getUser(res, req);
        if (!currentUser) {
          res.status(401).send({ error: "Authorization Required" });
          return;
        }
      }
      let body = undefined;
      if (req.body && handler.types?.body) {
        const parseResult = handler.types?.body.safeParse(
          req.body ? prepareZodObjectForDeserialization(parseIfNeeded(req.body)) : undefined
        );

        if (!parseResult.success) {
          throw new ApiError(`Can't parse request body for ${req.method} ${req.url}`, {
            zodError: parseResult.error,
            body: tryJson(req.body),
          });
        }
        body = parseResult.data;
      } else if (req.body) {
        try {
          body = JSON.parse(req.body);
        } catch (e) {
          throw new ApiError(`Body ${req.method} ${req.url} is not a JSON object: ${getErrorMessage(e)}`, {
            body: req.body,
          });
        }
      }
      let query: any = undefined;
      if (handler.types?.query) {
        const parseResult = safeParseWithDate(handler.types?.query, req.query);
        if (!parseResult.success) {
          throw new ApiError(`Can't parse request query for ${req.method} ${req.url}`, {
            zodError: parseResult.error,
          });
        }
        query = parseResult.data;
      } else {
        query = req.query;
      }

      const result = await handler.handle({ body, req, res, query, user: currentUser as any });
      if (handler.streaming) {
        //we cannot do anything with the result, it is the responsibility of the handler to write the response
        return;
      }
      if (handler.types?.result) {
        const parseResult = handler.types?.result.safeParse(result);
        if (!parseResult.success) {
          log
            .atDebug()
            .log(
              `Api method zod mismatch at ${req.method} ${req.url}. Obj: ${JSON.stringify(
                result,
                null,
                2
              )}. Zod error: ${JSON.stringify(parseResult.error)}`
            );
          throw new ApiError(`Response for ${req.method} ${req.url} doesn't match required schema`, {
            zodError: parseResult.error,
          });
        }
        //do not set explicit 200 status here. If the status has been set by the handler, we should respect it. There's
        //no way to check if the status has been set. If status is not set here and in handler, Next.js will set 200 by default.
        res.json(parseResult.data);
      } else {
        res.json(result || { success: true });
      }
    } catch (e: any) {
      if (isApiError(e)) {
        const errorBody = {
          message: e?.message || "Unknown Error",
          ...e.responseObject,
        };
        const status = e.status || 500;
        if (status === 500) {
          errorBody.stack = e.stack;
          log
            .atError()
            .withCause(e)
            .log(`Request for ${req.method} ${req.url} failed - ${JSON.stringify(e.responseObject)}`);
        } else {
          log
            .atError()
            .log(
              `Request for ${req.method} ${req.url} failed - ${JSON.stringify(e.responseObject)}: ${errorBody.message}`
            );
        }
        res.status(status).send(errorBody);
      } else {
        log.atError().withCause(e).log(`Request for ${req.method} ${req.url} failed`);
        res
          .status(500)
          .send({ error: tryJson(getErrorMessage(e)), details: e?.stack, stackArray: stackToArray(e?.stack) });
      }
    }
  };
}

function stackToArray(stack?: string) {
  if (!stack) {
    return undefined;
  }
  const lines = stack.split("\n");
  return lines.length > 0 ? lines.map(s => s.trim()) : undefined;
}
export async function verifyAdmin(user: SessionUser) {
  if (user.internalId === adminServiceAccountEmail && user.loginProvider === "admin/token") {
    return;
  }
  const userId = requireDefined(user.internalId, `internalId is not defined`);
  if ((await db.prisma().userProfile.findFirst({ where: { id: user.internalId } }))?.admin) {
    return;
  }
  throw new ApiError(`User ${userId} is not an admin`, { status: 403 });
}

export function looksLikeCuid(id: string) {
  return id.length === 25 && id.charAt(0) === "c";
}

export async function getWorkspace(workspaceId: string | undefined) {
  return requireDefined(
    await db.prisma().workspace.findFirst({
      where: {
        OR: [
          {
            id: workspaceId,
          },
          {
            slug: workspaceId,
          },
        ],
        deleted: false,
      },
    }),
    `Workspace ${workspaceId} not found`
  );
}

export async function verifyAccess(user: SessionUser, workspaceId: string) {
  if (user.internalId === adminServiceAccountEmail && user.loginProvider === "admin/token") {
    return;
  }
  if (!looksLikeCuid(workspaceId)) {
    const w = await db.prisma().workspace.findFirst({ where: { slug: workspaceId } });
    if (w) {
      workspaceId = w.id;
    }
  }
  const userId = requireDefined(user.internalId, `internalId is not defined`);
  if ((await db.prisma().workspaceAccess.count({ where: { userId, workspaceId } })) === 0) {
    if ((await db.prisma().userProfile.findFirst({ where: { id: user.internalId } }))?.admin) {
      return;
    }
    throw new ApiError(
      `User ${userId} doesn't have access to workspace ${workspaceId}`,
      { workspaceId, userId },
      { status: 403 }
    );
  }
}

//new type-safe route builder

export type RouteBuilderBase = {
  [K in HttpMethodType]: <
    QueryZodType extends ZodType = never,
    BodyZodType extends ZodType = never,
    ResultZodType extends ZodType = any,
    RequireAuth extends undefined | boolean = false
  >(spec: {
    description?: string;
    query?: QueryZodType;
    body?: BodyZodType;
    result?: ResultZodType;
    auth?: RequireAuth;
    streaming?: boolean;
  }) => {
    handler: (
      handler: (params: {
        query: QueryZodType extends ZodType<infer QueryType> ? QueryType : never;
        body: BodyZodType extends ZodType<infer BodyType> ? BodyType : never;
        req: NextApiRequest;
        res: NextApiResponse;
        user: RequireAuth extends true ? SessionUser : never;
      }) => ResultZodType extends ZodType<infer ResultType> ? ResultType | Promise<ResultType> : void | Promise<void>
    ) => RouteBuilder;
  };
};

export type RouteBuilder = RouteBuilderBase & { toNextApiHandler(): NextApiHandler };

export function createRoute(): RouteBuilder {
  const legacyApiInstance: Api = {};
  const builder: any = {};
  for (const method of httpMethods) {
    builder[method] = ({ query, body, result, auth, streaming }) => {
      return {
        handler: handler => {
          legacyApiInstance[method] = {
            auth: !!auth,
            types: { query, body, result },
            handle: handler,
            streaming: streaming,
          };
          return builder;
        },
      };
    };
  }
  builder.toNextApiHandler = () => {
    return nextJsApiHandler(legacyApiInstance);
  };

  return builder as RouteBuilder;
}
