import { NextApiRequest, NextApiResponse } from "next";
import { getUser, verifyAccess, verifyAdmin } from "../../../../lib/api";
import { createJwt, getEeConnection } from "../../../../lib/server/ee";
import { isEEAvailable } from "../../ee/jwt";
import { getLog } from "juava";

function removeDoubleSlashes(path: string) {
  return path.replace(/\/\//g, "/");
}

//If string is a JSON, parse it, so it looks better in JSON response. Needed for
//errors display only
function toJSON(str: string): any {
  try {
    return JSON.parse(str);
  } catch (e) {
    return str;
  }
}

function removeTrailingSlashes(url: string) {
  while (url.endsWith("/")) {
    url = url.slice(0, -1);
  }
  return url;
}

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getUser(res, req);
  if (!isEEAvailable()) {
    res.status(400).send({ error: "EE server URL is not set" });
    return;
  }
  if (!user) {
    res.status(401).send({ error: "Authorization Required" });
    return;
  }
  const workspaceId = req.query.workspaceId as string;
  const proxyPath = req.query.proxyPath as string[];
  if (workspaceId === "$none") {
    //do nothing, $none means that the downstream end-point is public
  } else if (workspaceId === "$all") {
    //only admins can access to all workspaces
    await verifyAdmin(user);
  } else {
    await verifyAccess(user, workspaceId);
  }
  const { jwt } =
    workspaceId !== "$none" ? createJwt(user.internalId, user.email, workspaceId, 60) : { jwt: undefined };
  const query = {
    ...(req.query || {}),
    workspaceId: workspaceId === "$all" || workspaceId === "$none" ? undefined : workspaceId,
  };
  const queryString = Object.entries(query)
    .filter(([, val]) => val !== undefined)
    .map(([key, val]) => `${key}=${encodeURIComponent(val + "")}`)
    .join("&");
  //if slash symbols are messed up, Next.js will respond with redirect, which we do not support here
  const url =
    removeTrailingSlashes(getEeConnection().host) + removeDoubleSlashes(`/api/${proxyPath.join("/")}?${queryString}`);
  const response = await fetch(url, {
    method: req.method,
    headers: {
      "Content-Type": "application/json",
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      Accept: "application/json",
    },
    redirect: "manual",
    body: req.body || undefined,
  });
  if (response.status >= 301 && response.status <= 308) {
    const location = response.headers.get("location") || response.headers.get("Location");
    getLog().atInfo().withCause(`${url} redirects to ${location}`);
    if (!location) {
      res.status(500).send({
        url,
        status: response.status,
        statusText: response.statusText,
        error: `Status ${response.status} but no location header found`,
      });
      return;
    }
    //apparently we can't do that, since sometimes the endpoint returns a legitimate redirect
    //theoretically it's possible to distinguish external redirects, from internal ones,
    //but it's too much for this validation
    // res.status(400).json({
    //   url,
    //   error: `Response is redirect to ${location}, but the proxy doesn't support redirects yet`,
    // });
    return location;
  }
  if (!response.ok) {
    res.status(response.status).send({
      url,
      status: response.status,
      statusText: response.statusText,
      error: toJSON(await response.text()),
    });
    return;
  } else {
    res.status(response.status).send(await response.json());
  }
};

export default handler;
