import { useRouter } from "next/router";
import { GlobalLoader } from "../components/GlobalLoader/GlobalLoader";
import { EmbeddedErrorMessage, GlobalError } from "../components/GlobalError/GlobalError";
import React from "react";
import { useApi } from "../lib/useApi";
import { ContextApiResponse } from "../lib/schema";
import { FirebaseSignup } from "../components/SignInOrUp/FirebaseSignup";
import { WORK_EMAIL_REQUIRED_MESSAGE } from "../lib/shared/email-domains";
import { Button, Modal } from "antd";
import { encrypt, getLog, randomId, rpc } from "juava";
import { useUserSessionControls } from "../lib/context";

const log = getLog("index");

function WorkspaceRedirect() {
  const router = useRouter();
  const sessionControl = useUserSessionControls();

  const { data, isLoading, error } = useApi<ContextApiResponse>("/api/init-user", {
    outputType: ContextApiResponse,
  });

  if (isLoading) {
    return <GlobalLoader title={"Redirecting..."} />;
  } else if (error) {
    if ((error as any).response?.code === "signup-disabled") {
      return (
        <div className="w-full h-full flex justify-start items-center">
          <EmbeddedErrorMessage
            className="max-w-4xl mx-auto"
            actions={
              <Button type="primary" onClick={sessionControl.logout}>
                Go back
              </Button>
            }
          >
            New account creation is disabled by the owner of this instance
          </EmbeddedErrorMessage>
        </div>
      );
    }
    if ((error as any).response?.code === "personal-email-rejected") {
      // No special page — render the signup form with the note. The user's
      // Firebase account was already deleted server-side, so a retry with a work
      // email starts clean.
      return <FirebaseSignup initialError={WORK_EMAIL_REQUIRED_MESSAGE} />;
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
    } else if (data.redirect) {
      // Redirect to specified path
      router.push(data.redirect);
    } else if (data.firstWorkspaceSlug || data.firstWorkspaceId) {
      router.push(`/${data.firstWorkspaceSlug || data.firstWorkspaceId}`);
    } else {
      // Fallback to workspaces page if no specific workspace is identified
      router.push("/workspaces");
    }
    //return <GlobalLoader title={"Redirecting..."} />;
  }
}

export default WorkspaceRedirect;
