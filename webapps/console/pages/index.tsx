import { useRouter } from "next/router";
import { GlobalLoader } from "../components/GlobalLoader/GlobalLoader";
import { EmbeddedErrorMessage, GlobalError } from "../components/GlobalError/GlobalError";
import React from "react";
import { useApi } from "../lib/useApi";
import { ContextApiResponse } from "../lib/schema";
import { Button, Modal } from "antd";
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
                    log.atWarn().withCause(err).log(`Can't sign ut from firebase`);
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
    const redirect = (router.query.redirect as string) ?? "";
    const redir = (query: string) => {
      if (redirect.match(/http:\/\/localhost:\d{4,5}\//)) {
        window.location.href = `${router.query.redirect}?${query}`;
      } else {
        router.push(`/cli?${query}`);
      }
    };
    if (origin === "jitsu-cli") {
      return (
        <Modal
          open={true}
          maskClosable={false}
          closable={false}
          title={
            <div className={"flex flex-row items-center"}>
              <img alt={""} src="/logo.svg" className="anticon h-5 w-5 mr-2" />
              <span>Jitsu CLI authorization</span>
            </div>
          }
          width={500}
          okText={"Authorize"}
          onOk={() => {
            //local request from jitsu-cli
            rpc("/api/user/cli-key")
              .then(key => {
                if (key) {
                  const iv = randomId(16 - origin.length);
                  const enc = encrypt(router.query.c as string, `${origin}${iv}`, JSON.stringify(key));
                  redir(`code=${iv}${enc}`);
                } else {
                  redir(`err=${encodeURIComponent("Failed to get CLI key")}`);
                }
              })
              .catch(err => {
                redir(`err=${encodeURIComponent(err.message)}`);
              });
          }}
          onCancel={() => {
            redir(`err=${encodeURIComponent("Authorization was cancelled.")}`);
          }}
        >
          Do you want to authorize Jitsu CLI to use your account?
        </Modal>
      );
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
