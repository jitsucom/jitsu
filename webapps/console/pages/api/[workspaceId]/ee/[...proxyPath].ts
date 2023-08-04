import { NextApiRequest, NextApiResponse } from "next";
import { getUser, verifyAccess } from "../../../../lib/api";
import { createJwt, getEeConnection } from "../../../../lib/server/ee";
import { isEEAvailable } from "../../ee/jwt";

function removeDoubleSlashes(path: string) {
  return path.replace(/\/\//g, "/");
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
  await verifyAccess(user, workspaceId);
  const { jwt } = createJwt(user.internalId, user.email, workspaceId, 60);
  const query = {
    ...(req.query || {}),
    workspaceId: workspaceId === "$all" ? undefined : workspaceId,
  };
  const queryString = Object.entries(query)
    .filter(([, val]) => val !== undefined)
    .map(([key, val]) => `${key}=${encodeURIComponent(val + "")}`)
    .join("&");
  const url = removeDoubleSlashes(`${getEeConnection().host}/api/${proxyPath.join("/")}?${queryString}`);
  const response = await fetch(url, {
    method: req.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
    },
    redirect: "manual",
    body: req.body || undefined,
  });
  if (response.status >= 301 && response.status <= 308) {
    const location = response.headers.get("location") || response.headers.get("Location");
    if (!location) {
      res.status(500).send({
        url,
        status: response.status,
        statusText: response.statusText,
        error: `Status ${response.status} but no location header found`,
      });
      return;
    }
    res.redirect(response.status, location);
    return;
  }
  if (!response.ok) {
    res.status(response.status).send({
      url,
      status: response.status,
      statusText: response.statusText,
      error: await response.text(),
    });
    return;
  } else {
    res.status(response.status).send(await response.json());
  }
};

export default handler;
