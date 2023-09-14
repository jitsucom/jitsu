import { useRouter } from "next/router";
import { GlobalLoader } from "../components/GlobalLoader/GlobalLoader";
import { EmbeddedErrorMessage, GlobalError } from "../components/GlobalError/GlobalError";
import React from "react";
import { useApi } from "../lib/useApi";
import { ContextApiResponse } from "../lib/schema";
import { Button } from "antd";
import { signOut } from "next-auth/react";
import { firebaseSignOut } from "../lib/firebase-client";
import { encrypt, getLog, randomId, rpc } from "juava";

const log = getLog("index");

function WorkspaceRedirect() {
  const router = useRouter();
  const projectName = localStorage.getItem("projectName");
  const params = {
    projectName: projectName || undefined,
    invite: (router.query.invite as string) || undefined,
  };
  const { data, isLoading, error } = useApi<ContextApiResponse>(
    "/api/init-user" +
      (Object.entries(params).length > 0
        ? "?" +
          Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
            .join("&")
        : ""),
    {
      outputType: ContextApiResponse,
    }
  );

  if (isLoading) {
    return <GlobalLoader title={"Redirecting..."} />;
  } else if (error) {
    if ((error as any).response?.code === "signup-disabled") {
      return (
        <div className="w-full h-full flex justify-start items-center">
          <EmbeddedErrorMessage
            className="max-w-4xl mx-auto"
            actions={
              <Button
                type="primary"
                onClick={async () => {
                  //we can't use current session here, since the error can be originated
                  //from auth layer. Try to logout using all methods
                  signOut().catch(err => {
                    log.atWarn().withCause(err).log(`Can't sign ut from next-auth`);
                  });
                  firebaseSignOut().catch(err => {
                    log.atWarn().withCause(err).log(`Can't sign ut from next-auth`);
                  });
                }}
              >
                Go back
              </Button>
            }
          >
            New account creation is disabled by the owner of this instance
          </EmbeddedErrorMessage>
        </div>
      );
    }
    return <GlobalError error={error} />;
  } else if (data) {
    const origin = router.query.origin as string;
    const redirect = router.query.redirect as string;
    if (origin === "jitsu-cli") {
      if (redirect.match(/http:\/\/localhost:\d{4,5}\//)) {
        //local request from jitsu-cli
        rpc("/api/user/cli-key")
          .then(key => {
            if (key) {
              const c = `${origin}-${router.query.c}`;
              const iv = randomId(32);
              encrypt(c, iv, JSON.stringify(key));
              window.location.href = `${router.query.redirect}?c=${iv}${key}`;
            } else {
              router.push(`/cli?error=failed+to+get+CLI+key`);
            }
          })
          .catch(err => {
            router.push(`/cli?error=${encodeURIComponent(err.message)}`);
          });
      }
      router.push(router.query.redirect as string);
    } else if (data.firstWorkspaceSlug || data.firstWorkspaceId) {
      router.push(`/${data.firstWorkspaceSlug || data.firstWorkspaceId}${data.newUser ? "?welcome=true" : ""}`);
    } else {
      //TODO: seems like we don't need this anymore and there is no such page
      router.push(`/create-workspace?welcome=true`);
    }
    //return <GlobalLoader title={"Redirecting..."} />;
  }
}

export default WorkspaceRedirect;
