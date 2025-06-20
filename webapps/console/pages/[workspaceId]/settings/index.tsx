import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { Alert, Button, Input, Spin, Tooltip } from "antd";
import { useAppConfig, useUser, useWorkspace } from "../../../lib/context";
import React, { useState } from "react";
import { confirmOp, confirmOpWithInput, feedbackError, feedbackSuccess } from "../../../lib/ui";
import { get } from "../../../lib/useApi";
import { SafeUserProfile, UserWorkspaceRelation } from "../../../lib/schema";
import { useQuery } from "@tanstack/react-query";
import { AsyncButton } from "../../../components/AsyncButton/AsyncButton";
import { CopyButton } from "../../../components/CopyButton/CopyButton";
import { WorkspaceNameAndSlugEditor } from "../../../components/WorkspaceNameAndSlugEditor/WorkspaceNameAndSlugEditor";
import { requireDefined } from "juava";
import { FaExternalLinkAlt, FaGithub, FaGoogle, FaUser } from "react-icons/fa";
import Link from "next/link";
import { AntdModal, useAntdModal } from "../../../lib/modal";
import { FiMail } from "react-icons/fi";
import { ArrowRight, Copy, Trash2, Key } from "lucide-react";
import { JitsuButton, WJitsuButton } from "../../../components/JitsuButton/JitsuButton";
import { useRouter } from "next/router";

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
      <div className="flex flex-auto gap-4">
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
        <Button loading={pending} type="primary" onClick={onSubmit}>
          {inputVisible ? "Send invitation" : "Add user to the workspace"}
        </Button>
      </div>
      {errorMessage && <div className="text-error">{errorMessage || "-"}</div>}
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
  const user = useUser();
  const m = useAntdModal();

  const {
    data: relations,
    isLoading,
    error,
    refetch,
  } = useQuery<UserWorkspaceRelation[], Error>({
    queryKey: ["workspace-users", workspace.id],
    queryFn: async () => {
      return (await get(`/api/workspace/${workspace.id}/users`)) as UserWorkspaceRelation[];
    },
  });

  const handleRemoveUser = async (relation: UserWorkspaceRelation) => {
    if (
      await confirmOp(
        relation.user
          ? `Are you sure you want to remove ${getUserDescription(relation.user)} from the project?`
          : `Are you sure you want to cancel ${relation.invitationEmail} invitation?`
      )
    ) {
      await get(`/api/workspace/${workspace.id}/users`, {
        method: "DELETE",
        query: relation.user ? { userId: relation.user.id } : { email: relation.invitationEmail },
      });
      refetch();
    }
  };

  const handleResendInvitation = async (email: string) => {
    await get(`/api/workspace/${workspace.id}/users`, {
      body: { email, resend: true },
    });
    refetch();
  };

  const handleInviteUser = async (email: string) => {
    const { invitationLink } = await get(`/api/workspace/${workspace.id}/users`, {
      method: "POST",
      body: { email },
    });
    refetch();
    showInvitationLink(m, invitationLink);
  };

  return (
    <div className="bg-backgroundLight border border-textDisabled rounded-lg overflow-hidden">
      <div className="px-6 py-4 bg-background border-b border-textDisabled">
        <h3 className="text-lg font-semibold text-textDark">Team Members</h3>
      </div>

      {error && (
        <div className="p-6">
          <Alert
            message="Failed to load users"
            description={error instanceof Error ? error.message : "An unexpected error occurred"}
            type="error"
            showIcon
          />
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-12">
          <Spin size="large" />
        </div>
      )}

      {!isLoading && !error && relations && (
        <>
          <div className="divide-y divide-textDisabled">
            {relations.map(r => (
              <div
                key={r.user?.id || r.invitationLink}
                className="flex items-center justify-between px-6 py-4 hover:bg-background"
              >
                <div className="flex items-center space-x-3">
                  <div>
                    {r.invitationEmail ? (
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">{r.invitationEmail}</span>
                        <span className="px-2 py-1 text-xs bg-warning/20 text-warning rounded-full">Pending</span>
                      </div>
                    ) : (
                      <Member user={requireDefined(r.user)} />
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {r.invitationEmail && r.canSendEmail && (
                    <AsyncButton
                      errorMessage="Failed to resend invitation"
                      successMessage="Invitation has been resent"
                      type="link"
                      size="small"
                      onClick={() => handleResendInvitation(r.invitationEmail!)}
                    >
                      Resend
                    </AsyncButton>
                  )}
                  {r.invitationLink && (
                    <Button type="link" size="small" onClick={() => showInvitationLink(m, r.invitationLink || "")}>
                      Show Link
                    </Button>
                  )}
                  {r.user?.id === user.internalId ? (
                    <span className="px-2 py-1 text-xs bg-primary/20 text-primary rounded-full">You</span>
                  ) : (
                    <Tooltip title="Remove member">
                      <AsyncButton
                        type="text"
                        danger
                        size="small"
                        icon={<Trash2 className="w-5 h-5" />}
                        onClick={() => handleRemoveUser(r)}
                      />
                    </Tooltip>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="px-6 py-4 bg-background border-t border-textDisabled">
            <InviteUserForm invite={handleInviteUser} />
          </div>
        </>
      )}
    </div>
  );
};

const OidcProviders: React.FC<any> = () => {
  const workspace = useWorkspace();

  const oidcGroups = workspace.oidcLoginGroups || [];
  if (oidcGroups.length == 0) {
    return <></>;
  }

  return (
    <div className="bg-backgroundLight border border-textDisabled rounded-lg overflow-hidden">
      <div className="px-6 py-4 bg-background border-b border-textDisabled">
        <h3 className="text-lg font-semibold text-textDark">OIDC Providers</h3>
        <p className="text-sm text-textSecondary mt-1">Single sign-on providers configured for this workspace</p>
      </div>
      <div className="divide-y divide-textDisabled">
        {oidcGroups.map(group => (
          <div key={group.id} className="px-6 py-4 hover:bg-background/50 transition-colors">
            <div className="flex items-center space-x-3">
              <Key className="w-5 h-5 text-primary" />
              <span className="font-medium text-textDark">{group.oidcProvider.name}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const WorkspaceSettingsComponent: React.FC<any> = () => {
  const config = useAppConfig();
  const workspace = useWorkspace();
  const [deleteLoading, setDeleteLoading] = useState(false);
  const router = useRouter();

  const handleDeleteWorkspace = async () => {
    setDeleteLoading(true);
    try {
      if (await confirmOp(`This will delete ${workspace.name}. I understand the consequences of this action.`)) {
        if (await confirmOpWithInput(`To confirm, type "${workspace.name}" in the box below`, workspace.name)) {
          const res = await get("/api/workspace", {
            method: "DELETE",
            body: {
              workspaceId: workspace.id,
            },
          });
          if (res.status != 200) {
            feedbackError(`Failed to delete workspace ${res.message}`);
          } else {
            feedbackSuccess(`Workspace ${workspace.name} deleted successfully`);
            router.push("/workspaces");
          }
        }
      }
    } catch (e) {
      feedbackError(`Failed to delete workspace ${e}`);
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-4xl space-y-6">
        {/* Quick Actions Section */}
        <div className="border border-textDisabled rounded-lg overflow-hidden">
          <div className="px-6 py-4 bg-background border-b border-textDisabled">
            <h2 className="text-lg font-semibold text-textDark">Quick Actions</h2>
          </div>
          <div className="divide-y divide-textDisabled">
            {config.billingEnabled && (
              <div className="flex items-center justify-between px-6 py-5 hover:bg-background/50 transition-colors">
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-textDark mb-1">Plans & Billing</h3>
                  <p className="text-sm font-normal text-text">Manage your subscription and billing details</p>
                </div>
                <WJitsuButton
                  iconPosition="end"
                  icon={<ArrowRight className="-rotate-45 w-4 h-4" />}
                  href="/settings/billing"
                  type="primary"
                >
                  Manage Billing
                </WJitsuButton>
              </div>
            )}
            <div className="flex items-center justify-between px-6 py-5 hover:bg-background/50 transition-colors">
              <div className="flex-1">
                <h3 className="text-base font-semibold text-textDark mb-1">API Access</h3>
                <p className="text-sm font-normal text-text">Configure API keys and access tokens</p>
              </div>
              <JitsuButton
                iconPosition="end"
                icon={<ArrowRight className="-rotate-45 w-4 h-4" />}
                href="/user"
                type="primary"
              >
                Manage API Keys
              </JitsuButton>
            </div>
          </div>
        </div>

        {/* Workspace Configuration */}
        <div>
          <WorkspaceNameAndSlugEditor
            displayId={true}
            onSuccess={({ slug }) => (window.location.href = `/${slug}/settings`)}
          />
        </div>

        {/* OIDC Providers Section */}
        <OidcProviders />

        {/* Members Section */}
        <Members />

        {/* Danger Zone */}
        <div className="bg-backgroundLight border border-error/50 rounded-lg overflow-hidden">
          <div className="px-6 py-4 bg-error/5">
            <h3 className="text-lg font-semibold text-error">Danger Zone</h3>
          </div>
          <div className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="font-medium text-error mb-1">Delete Project</h4>
                <p className="text-sm text-textLight">
                  This workspace will be permanently deleted and cannot be recovered.
                </p>
              </div>
              <JitsuButton type="primary" danger={true} onClick={handleDeleteWorkspace} loading={deleteLoading}>
                Delete Workspace
              </JitsuButton>
            </div>
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
