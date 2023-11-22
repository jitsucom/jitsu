import { useAppConfig, useUser, useWorkspace } from "../../lib/context";
import React, { useState } from "react";
import { Button, Input } from "antd";
import { get } from "../../lib/useApi";
import { copyTextToClipboard, feedbackError, feedbackSuccess } from "../../lib/ui";
import { publicEmailDomains } from "../../lib/shared/email-domains";
import { getEeClient } from "../../lib/ee-client";
import { requireDefined } from "juava";
import { useClassicProject } from "../PageLayout/ClassicProjectProvider";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import { QuestionCircleOutlined } from "@ant-design/icons";

function ensureLength(res): string {
  return res.length < 5 ? res + "project" : res;
}

function pickSlug(email, name): string {
  if (name) {
    //remove 's workspace from name
    name = name.replace(/'s workspace$/g, "");
    return ensureLength(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
  }
  const [username, domain] = email.split("@");
  if (!publicEmailDomains.includes(domain.toLowerCase())) {
    const [company] = domain.split(".");
    return ensureLength(company.toLowerCase());
  }
  return ensureLength(username.replace(/[^a-z0-9]/g, ""));
}

/**
 * @param onboarding if the dialog is shown on onboarding page. For onboarding,
 * we should issue an event that onboarding is completed
 */
export function WorkspaceNameAndSlugEditor({
  onSuccess,
  displayId,
  offerClassic,
  onboarding,
}: {
  onSuccess?: (newVals: { name: string; slug: string }) => void;
  displayId?: boolean;
  offerClassic?: boolean;
  onboarding?: boolean;
}) {
  const workspace = useWorkspace();
  const appConfig = useAppConfig();
  const classicProject = useClassicProject();
  const user = useUser();
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug || pickSlug(user.email, workspace.name));
  const [changed, setChanged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [slugError, setSlugError] = useState<string | undefined>();
  return (
    <div className="px-8 py-6 border border-textDisabled rounded-lg">
      <div className="text-lg font-bold text-textLight pb-2">Workspace Name</div>
      <Input
        value={name}
        size="large"
        onChange={e => {
          setName(e.target.value);
          setChanged(true);
        }}
      />
      <div className="text-lg text-textLight font-bold pt-4 pb-2">Workspace Slug</div>
      <Input
        value={slug}
        size="large"
        onChange={e => {
          //setSlug(e.target.value ? e.target.value.toLowerCase().replaceAll(/[^a-z0-9-]/g, "") : "");
          setSlug(e.target.value);
          setChanged(true);
        }}
      />
      <div className={"text-sm text-red-600 p-0.5"}>{slugError}</div>
      {displayId && (
        <>
          <div className="text-lg text-textLight font-bold pt-4 pb-2">Workspace Id</div>
          <div
            className="cursor-pointer bg-textInverted text-textLight px-2 py-2 rounded-lg border border-textDisabled font-mono"
            onClick={() => {
              copyTextToClipboard(workspace.id);
              feedbackSuccess("Workspace id copied to clipboard");
            }}
          >
            {workspace.id}
          </div>
          <div key="workspace-hint" className="text-xs text-textLight ml-0.5 pt-1">
            You'll need this id for making{" "}
            <a className="underline" href="https://docs.jitsu.com/api">
              API calls
            </a>{" "}
          </div>
        </>
      )}
      <div className="pt-6 flex justify-between">
        <div className={"flex items-end"}>
          {offerClassic && classicProject.active && !!classicProject.project && (
            <>
              <div>
                <JitsuButton
                  type={"primary"}
                  ghost={true}
                  icon={<img alt={""} src="/logo-classic.svg" className="h-5 w-5 mr-2" />}
                  onClick={async () => {
                    try {
                      const eeClient = getEeClient(
                        requireDefined(appConfig.ee.host, `EE is not available`),
                        workspace.id
                      );
                      const customToken = await eeClient.createCustomToken();
                      window.location.href = `${appConfig.jitsuClassicUrl}/?token=${customToken}`;
                    } catch (e) {
                      feedbackError(`Can't navigate to Jitsu.Classic`, { error: e });
                    }
                  }}
                >
                  Switch to Jitsu Classic
                </JitsuButton>
              </div>
              <div className={"pl-2"}>
                <JitsuButton
                  icon={<QuestionCircleOutlined className={"mr-1"} />}
                  onClick={() => window.open("https://jitsu.com/blog/jitsu-next#migration-faq", "_blank")}
                >
                  Read about migration
                </JitsuButton>
              </div>
            </>
          )}
        </div>
        <Button
          type="primary"
          loading={loading}
          onClick={async () => {
            if (!slug) {
              feedbackError("Slug cannot be empty");
              return;
            }
            setLoading(true);
            try {
              if (workspace.slug !== slug) {
                const { valid, reason, suggestedSlug } = await get(`/api/workspace/slug-check`, { query: { slug } });
                if (!valid) {
                  setSlugError(reason);
                  if (suggestedSlug) {
                    setSlug(suggestedSlug);
                  }
                  return;
                }
              }
              await get(`/api/workspace/${workspace.id}?onboarding=${!!onboarding}`, {
                method: "PUT",
                body: { name, slug },
              });
              feedbackSuccess("Workspace name has been saved");
              if (onSuccess) {
                onSuccess({ name, slug });
              }
            } catch (e) {
              feedbackError(`Failed to save workspace name`, { error: e });
            } finally {
              setLoading(false);
            }
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
