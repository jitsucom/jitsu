import { get } from "./useApi";
import { DomainStatus } from "./server/ee";
import * as auth from "firebase/auth";

export type ClassicProjectStatus = {
  ok: boolean;
  uid: string | null;
  project: string | null;
  name: string | null;
  active: boolean;
};

export interface EeClient {
  attachDomain(domain: string): Promise<DomainStatus>;
  checkClassicProject(): Promise<ClassicProjectStatus>;
  createCustomToken(): Promise<string>;
}

type CachedToken = {
  token: string;
  expiresAt: Date;
};

function removeDoubleSlashes(s: string) {
  return s.replace(/([^:]\/)\/+/g, "$1");
}

export function getEeClient(host: string, workspaceId: string): EeClient {
  let cachedToken: CachedToken | undefined = undefined;
  const refreshTokenIfNeeded = async () => {
    //get short-lived (10m)
    if (!cachedToken || cachedToken.expiresAt < new Date()) {
      const refreshed = await get(`/api/ee/jwt`, { query: { workspaceId } });
      cachedToken = {
        token: refreshed.jwt,
        expiresAt: new Date(refreshed.expiresAt),
      };
    }
    return cachedToken;
  };
  return {
    attachDomain: async domain => {
      cachedToken = await refreshTokenIfNeeded();
      return await get(removeDoubleSlashes(`${host}/api/domain`), {
        query: { domain },
        headers: {
          Authorization: `Bearer ${cachedToken.token}`,
        },
      });
    },
    checkClassicProject: async () => {
      const fbToken = await auth.getAuth().currentUser?.getIdToken();
      return await get(removeDoubleSlashes(`${host}/api/is-active`), {
        credentials: "include",
        cache: "default",
        mode: "cors",
        headers: {
          Authorization: `Bearer ${fbToken}`,
        },
      });
    },
    createCustomToken: async () => {
      const fbToken = await auth.getAuth().currentUser?.getIdToken();
      const res = await get(removeDoubleSlashes(`${host}/api/custom-token`), {
        headers: {
          Authorization: `Bearer ${fbToken}`,
        },
      });
      return res.customToken;
    },
  };
}
