import { useRouter } from "next/router";
import { GlobalLoader } from "../components/GlobalLoader/GlobalLoader";
import { EmbeddedErrorMessage, GlobalError } from "../components/GlobalError/GlobalError";
import React from "react";
import { useApi } from "../lib/useApi";
import { ContextApiResponse } from "../lib/schema";
import { Button } from "antd";
import { signOut } from "next-auth/react";
import { firebaseSignOut } from "../lib/firebase-client";
import { getLog } from "juava";

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
    if (data.firstWorkspaceSlug || data.firstWorkspaceId) {
      router.push(`/${data.firstWorkspaceSlug || data.firstWorkspaceId}${data.newUser ? "?welcome=true" : ""}`);
    } else {
      //TODO: seems like we don't need this anymore and there is no such page
      router.push(`/create-workspace?welcome=true`);
    }
    //return <GlobalLoader title={"Redirecting..."} />;
  }
}

export default WorkspaceRedirect;
