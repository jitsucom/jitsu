import * as auth from "firebase/auth";
import {rpc} from "./rpc";

export type ClassicProjectStatus = {
  ok: boolean;
  uid: string | null;
  project: string | null;
  name: string | null;
  active: boolean | null;
  token?: string;
};

export interface JitsuNextEeClient {
  checkClassicProject(): Promise<ClassicProjectStatus>;
  createCustomToken(): Promise<string>;
}

function removeDoubleSlashes(s: string) {
  return s.replace(/([^:]\/)\/+/g, "$1");
}

export function getJitsuNextEeClient(host: string): JitsuNextEeClient {
  return {
    checkClassicProject: async () => {
      const fbToken = await auth.getAuth().currentUser?.getIdToken();
      return await rpc(removeDoubleSlashes(`${host}/api/is-active`), {
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
      const res = await rpc(removeDoubleSlashes(`${host}/api/custom-token`), {
        headers: {
          Authorization: `Bearer ${fbToken}`,
        },
      });
      return res.customToken;
    },
  };
}
