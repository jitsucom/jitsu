import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { Button, Input } from "antd";
import { useAppConfig, useUser, useWorkspace } from "../../../lib/context";
import React, { useState } from "react";
import { confirmOp, feedbackError } from "../../../lib/ui";
import { get, useApi } from "../../../lib/useApi";
import { QueryResponse } from "../../../components/QueryResponse/QueryResponse";
import { SafeUserProfile, UserWorkspaceRelation } from "../../../lib/schema";
import { AsyncButton } from "../../../components/AsyncButton/AsyncButton";
import { CopyButton } from "../../../components/CopyButton/CopyButton";
import { WorkspaceNameAndSlugEditor } from "../../../components/WorkspaceNameAndSlugEditor/WorkspaceNameAndSlugEditor";
import { requireDefined } from "juava";
import { FaExternalLinkAlt, FaGithub, FaGoogle, FaUser } from "react-icons/fa";
import Link from "next/link";
import { AntdModal, useAntdModal } from "../../../lib/modal";
import { FiMail } from "react-icons/fi";
import { ArrowRight, Copy } from "lucide-react";
import { JitsuButton, WJitsuButton } from "../../../components/JitsuButton/JitsuButton";

const InviteUserForm: React.FC<{ invite: (email: string) => Promise<void> }> = ({ invite }) => {
  const [inputVisible, setInputVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();

  const onSubmit = async () => {
    if (!inputVisible) {
      setInputVisible(true);
    } else {
      setPending(true);
      try {
        await invite(email as string);
        setInputVisible(false);
      } catch (e: any) {
        feedbackError("Failed to add user to the project ", { error: e });
      } finally {
        setPending(false);
      }
    }
  };
  return (
    <>
      <div className="flex transition-all duration-1000 mr-4">
        <Input
          onChange={e => setEmail(e.target.value)}
          placeholder="Enter email"
          onKeyPress={async e => {
            if (e.key === "Enter") {
              return onSubmit();
            }
          }}
          disabled={pending}
          className={`${inputVisible ? "opacity-100 w-full mr-4" : "opacity-0 w-0 m-0 p-0 invisible"}`}
        />
        <Button className="ml-5" loading={pending} type="primary" onClick={onSubmit}>
          {inputVisible ? "Send invitation" : "Add user to the workspace"}
        </Button>
      </div>
      <div className={`text-error ${errorMessage ? "visible" : "invisible"}`}>{errorMessage || "-"}</div>
    </>
  );
};

function showInvitationLink(m: AntdModal, link: string) {
  m.info({
    title: "Share invitation link",
    width: 600,
    content: (
      <div>
        <div className="text-sm text-textSecondary">
          Anyone with this link can join the workspace. The link can be used only once
        </div>
        <div className="mt-4 flex items-center">
          <code>{link}</code>
          <CopyButton text={link}>
            <Copy className="w-3 h-3" />
          </CopyButton>
        </div>
      </div>
    ),
  });
}

export type {};

function getIcon(provider: string) {
  if (provider.indexOf("github") >= 0) {
    return <FaGithub />;
  } else if (provider.indexOf("google") >= 0) {
    return <FaGoogle />;
  } else if (provider.indexOf("credentials") >= 0) {
    return <FiMail />;
  }
  return <FaUser />;
}

function Member({ user }: { user: SafeUserProfile }) {
  return (
    <div className="flex items-center">
      <div>{getIcon(user.loginProvider)}</div>
      <div className="ml-2">{user.externalUsername || user.email}</div>
      {user.externalUsername && user.loginProvider === "github" && (
        <div className="ml-2">
          <Link href={`https://github.com/${user.externalUsername}`}>
            <FaExternalLinkAlt />
          </Link>
        </div>
      )}
    </div>
  );
}

function getUserDescription(user: SafeUserProfile): string {
  if (user.externalUsername) {
    return `${user.externalUsername} (${user.loginProvider})`;
  } else {
    return user.email;
  }
}

const Members: React.FC<any> = () => {
  const workspace = useWorkspace();
  const remote = useApi<UserWorkspaceRelation[]>(`/api/workspace/${workspace.id}/users`);
  const user = useUser();
  const m = useAntdModal();

  return (
    <div className="px-8 py-6 border border-textDisabled rounded-lg mt-12">
      <QueryResponse
        result={remote}
        errorTitle="Failed to load users"
        render={(relations: UserWorkspaceRelation[]) => {
          return (
            <>
              <div className="text-lg font-bold pb-6">Users</div>
              <div className="flex flex-col">
                {relations.map(r => (
                  <div
                    key={r.user?.id || r.invitationLink}
                    className="flex items-center hover:bg-backgroundDark px-4 py-2 rounded-lg"
                  >
                    <div className="flex-grow flex items-center">
                      <div className="font-bold">
                        {r.invitationEmail ? r.invitationEmail : <Member user={requireDefined(r.user)} />}
                        {r.invitationEmail && (
                          <span className="font-bold text-textDisabled pl-2">Invitation pending</span>
                        )}
                      </div>
                    </div>
                    <div className="flex-grow text-right">
                      {r.invitationEmail && r.canSendEmail && (
                        <>
                          <AsyncButton
                            errorMessage="Failed to resend invitation"
                            successMessage="Invitation has been resent"
                            type="link"
                            className="mr-2"
                            onClick={() =>
                              get(`/api/workspace/${workspace.id}/users/invite`, {
                                body: {
                                  email: r.invitationEmail,
                                  resend: true,
                                },
                              })
                            }
                          >
                            Resend
                          </AsyncButton>
                        </>
                      )}
                      {r.invitationLink && (
                        <>
                          <Button
                            type="link"
                            className="mr-2"
                            onClick={() => showInvitationLink(m, r.invitationLink || "")}
                          >
                            Show Invitation
                          </Button>
                        </>
                      )}
                      {r.user?.id === user.internalId ? (
                        <Button type="text" disabled={true}>
                          <span className="font-bold">You</span>
                        </Button>
                      ) : (
                        <AsyncButton
                          danger
                          onClick={async () => {
                            if (
                              await confirmOp(
                                r.user
                                  ? `Are you sure you want to remove ${getUserDescription(r.user)} from the project?`
                                  : `Are you sure you want to cancel ${r.invitationEmail} invitation?`
                              )
                            ) {
                              await get(`/api/workspace/${workspace.id}/users`, {
                                method: "DELETE",
                                query: r.user ? { userId: r.user.id } : { email: r.invitationEmail },
                              });
                            }
                          }}
                          onSuccess={() => remote.reload()}
                        >
                          {r.invitationEmail ? "Revoke" : "Remove"}
                        </AsyncButton>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="pl-3 mt-6">
                <InviteUserForm
                  invite={async email => {
                    const { invitationLink } = await get(`/api/workspace/${workspace.id}/users`, {
                      method: "POST",
                      body: { email: email },
                    });
                    await remote.reload();
                    showInvitationLink(m, invitationLink);
                  }}
                />
              </div>
            </>
          );
        }}
      />
    </div>
  );
};

const WorkspaceSettingsComponent: React.FC<any> = () => {
  const config = useAppConfig();
  const workspace = useWorkspace();
  return (
    <div className="flex justify-center pt-6">
      <div className="w-full max-w-4xl grow">
        {config.billingEnabled && (
          <div className="px-8 py-6 border border-textDisabled rounded-lg mt-12 mb-12">
            <div className="text-lg font-bold pb-6">Plans & Billing</div>
            <div className="flex justify-center">
              <WJitsuButton
                iconPosition="right"
                icon={<ArrowRight className="-rotate-45 w-4 h-4" />}
                href={"/settings/billing"}
                size="large"
                type="primary"
              >
                Manage Billing {"&"} Plan
              </WJitsuButton>
            </div>
          </div>
        )}

        <WorkspaceNameAndSlugEditor
          displayId={true}
          onSuccess={({ slug }) => (window.location.href = `/${slug}/settings`)}
        />
        <Members />
        <div className="px-8 py-6 border border-textDisabled rounded-lg mt-12 mb-12">
          <div className="text-lg font-bold pb-6">API Access</div>
          <div className="flex justify-center">
            <JitsuButton
              iconPosition="right"
              icon={<ArrowRight className="-rotate-45 w-4 h-4" />}
              href={"/user"}
              size="large"
              type="primary"
            >
              Manage API Keys in user settings
            </JitsuButton>
          </div>
        </div>
      </div>
    </div>
  );
};

const WorkspaceSettings: React.FC<any> = () => {
  return (
    <WorkspacePageLayout doNotBlockIfUsageExceeded={true}>
      <WorkspaceSettingsComponent />
    </WorkspacePageLayout>
  );
};

export default WorkspaceSettings;
