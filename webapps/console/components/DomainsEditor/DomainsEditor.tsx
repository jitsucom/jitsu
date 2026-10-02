import React, { PropsWithChildren, useState } from "react";
import { CustomWidgetProps } from "../ConfigObjectEditor/Editors";
import { useWorkspace } from "../../lib/context";
import { DomainCheckResponse } from "../../lib/shared/domain-check-response";
import { get } from "../../lib/useApi";
import { confirmOp, feedbackError } from "../../lib/ui";
import { Button, Input, notification, Tag, Tooltip } from "antd";
import { useQuery } from "@tanstack/react-query";
import { getAntdModal, useAntdModal } from "../../lib/modal";
import { Globe } from "lucide-react";
import { FaExternalLinkAlt, FaSpinner, FaTrash, FaWrench } from "react-icons/fa";
import { ReloadOutlined } from "@ant-design/icons";
import { useRouter } from "next/router";
import { WLink } from "../Workspace/WLink";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import { useBilling } from "../Billing/BillingProvider";
import { EntitlementStatus } from "../Billing/EntitlementStatus";
import { useEntitlements } from "../../lib/entitlements";

const StatusBadge: React.FC<
  PropsWithChildren<{ status: "error" | "warning" | "info" | "success" | "loading"; className?: string }>
> = ({ status, children, className }) => {
  let color: string | undefined;
  let defaultDescription: string;
  if (status === "error") {
    color = "red";
    defaultDescription = "Error";
  } else if (status === "success") {
    color = "cyan";
    defaultDescription = "Success";
  } else if (status === "info") {
    color = "geekblue";
    defaultDescription = "Info";
  } else if (status === "warning") {
    color = "orange";
    defaultDescription = "Warning";
  } else {
    color = undefined;
    defaultDescription = "Loading";
  }
  return <Tag color={color}>{children || defaultDescription}</Tag>;
};

function displayErrorFeedback(opts?: { message?: string; error?: any }) {
  notification.open({
    message: "An error occurred while processing your request. Please try again later.",
    description: `Error: ${opts?.message || opts?.error?.message || opts?.error?.toString() || "Unknown error"}`,
    onClick: () => {
      //console.log("Notification Clicked!");
    },
  });
}

/** Why Add is locked. Shown as a tooltip, so it must stand alone. */
export function domainsLockedTooltip(billingEnabled: boolean): string {
  return (
    "Custom domains are available on the Business and Enterprise plans. Your existing domains keep working. " +
    (billingEnabled ? "Upgrade to add more." : "Contact your workspace administrator to change the plan.")
  );
}

/** Confirmation text for removing a domain. A plan without the entitlement cannot add it back. */
export function removeDomainConfirmation(domain: string, removalIsFinal: boolean): string {
  return removalIsFinal
    ? `Remove domain ${domain}? Your plan doesn't include custom domains, so you won't be able to add it back unless you upgrade to Business or Enterprise.`
    : `Are you sure you want to remove domain ${domain}?`;
}

const CustomDomain: React.FC<{
  domain: string;
  deleteDomain?: () => Promise<void>;
  workspaceDomain?: boolean;
  /** True when the plan cannot add domains, so removing this one cannot be undone. */
  removalIsFinal?: boolean;
}> = ({ domain, deleteDomain, workspaceDomain, removalIsFinal = false }) => {
  const workspace = useWorkspace();
  const router = useRouter();

  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const { data, isLoading, error, refetch } = useQuery<DomainCheckResponse>(
    ["domain-status", domain.toLowerCase(), reloadTrigger],
    async () => {
      return await get(`/api/${workspace.id}/domain-check?domain=${domain.toLowerCase()}`);
    },
    { cacheTime: 0 }
  );
  const m = useAntdModal();
  return (
    <div className={"rounded-lg border py-2 pl-4 hover:bg-backgroundDark"}>
      <>
        <div className="flex items-center">
          {/*<div>*/}
          {/*  <FaCaretRight />*/}
          {/*</div>*/}
          <div className={"text-blue-600 w-4 h-4 mr-1.5"}>
            <Globe
              className={`w-full h-full ${error ? "text-red-600" : data?.ok ? "text-blue-600" : "text-yellow-600"}`}
            />
          </div>
          <div className="font-bold  text-lg">{domain}</div>
          <div className="flex-grow flex items-center justify-end">
            <Tooltip title={`Open ${domain} site in a new tab`}>
              <Button
                type="text"
                onClick={() => {
                  window.open(`https://${domain}`, "_blank");
                }}
                disabled={deleting}
                className="border-0"
              >
                <FaExternalLinkAlt />
              </Button>
            </Tooltip>
            {data?.reason === "requires_cname_configuration" && (
              <Tooltip title="See configuration instructions">
                <Button
                  type="text"
                  danger
                  disabled={isLoading || deleting}
                  onClick={() => {
                    DomainConfigurationInstructions.show({ domain, status: data! });
                  }}
                  className="border-0"
                >
                  <FaWrench />
                </Button>
              </Tooltip>
            )}
            <Tooltip title="Re-check domain status">
              <Button
                type="text"
                disabled={isLoading || deleting}
                onClick={() => {
                  setReloadTrigger(reloadTrigger + 1);
                }}
                className="border-0"
              >
                <ReloadOutlined />
              </Button>
            </Tooltip>
            {deleteDomain && (
              <JitsuButton
                requiredPermission={"deleteEntities"}
                type="text"
                disabled={deleting}
                loading={deleting}
                onClick={async () => {
                  if (await confirmOp(removeDomainConfirmation(domain, removalIsFinal))) {
                    try {
                      setDeleting(true);
                      await deleteDomain();
                    } catch (e) {
                      displayErrorFeedback({ message: `Can't remove domain ${domain}`, error: e });
                    } finally {
                      setDeleting(false);
                    }
                  }
                }}
                className="border-0"
              >
                {!deleting && <FaTrash />}
              </JitsuButton>
            )}
            {workspaceDomain && (
              <Tag
                className={"cursor-pointer"}
                onClick={() => {
                  router.push(`/${workspace.slugOrId}/settings/domains`);
                }}
              >
                Workspace Domain
              </Tag>
            )}
          </div>
        </div>
        <div className="flex items-center mt-1">
          <div className={"mr-2"}>Status:</div>
          {(() => {
            if (isLoading) {
              return (
                <StatusBadge status="loading">
                  <span className={"flex items-center"}>
                    <FaSpinner className="animate-spin mr-1" />
                    Checking Domain Status
                  </span>
                </StatusBadge>
              );
            } else if (data?.ok) {
              return <StatusBadge status="success">OK</StatusBadge>;
            } else if (data?.reason === "requires_cname_configuration") {
              return <StatusBadge status="warning">Configuration Required</StatusBadge>;
            } else if (data?.reason === "pending_ssl") {
              return <StatusBadge status="info">Issuing Certificate</StatusBadge>;
            } else {
              return <StatusBadge status="error">{data?.reason || "ERROR"}</StatusBadge>;
            }
          })()}
        </div>
        {error && (
          <div className="flex items-start mt-1">
            <div className={"mr-2"}>Description:</div>
            <div className="">{`${"Internal error"}`}</div>
          </div>
        )}
        {data?.reason === "requires_cname_configuration" && (
          <div className="flex items-start mt-1">
            <div className={"mr-2"}>Description:</div>
            <div className="">
              See{" "}
              <a
                className={"cursor-pointer"}
                onClick={() => DomainConfigurationInstructions.show({ domain, status: data! })}
              >
                <u>configuration instructions</u>
              </a>
            </div>
          </div>
        )}
        {data?.reason === "pending_ssl" && (
          <div className="flex items-start mt-1">
            <div className={"mr-2"}>Description:</div>
            <div className="">Issuing SSL certificate for the domain. It may take up to 10 minutes.</div>
          </div>
        )}
      </>
    </div>
  );
};
export type DNSRecordTableProps = {
  records: { name: string; type: string; value: string; ok: boolean }[];
};

export const DNSRecordTable: React.FC<DNSRecordTableProps> = ({ records }) => {
  return (
    <table className={"border-collapse"}>
      <thead>
        <tr className="font-bold  border">
          <td className="border p-2"> </td>
          <td className="border p-2">Type</td>
          <td className="border p-2">Name</td>
          <td className="border p-2">Value</td>
        </tr>
      </thead>
      <tbody>
        {records.map(({ name, type, value, ok }) => (
          <tr key={name + type + value} className="font-mono border">
            <td className="border p-2">{ok ? "✅" : "⚠️"}</td>
            <td className="p-2 align-top border">{type}</td>
            <td className="p-2 border">{name}</td>
            <td className="p-2 border">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export type DomainInstructionsProps = { domain: string; status: DomainCheckResponse };
const DomainConfigurationInstructions: React.FC<DomainInstructionsProps> & {
  show: (p: DomainInstructionsProps) => void;
} = ({ domain, status }) => {
  if (status.reason === "requires_cname_configuration") {
    return (
      <div>
        <h3 className="mt-6 mb-2">Set the following records on your DNS provider to continue</h3>
        <p className="bg-bgLight">
          <DNSRecordTable records={status.cnames.map(c => ({ ...c, type: "CNAME" }))} />
        </p>
      </div>
    );
  } else {
    return <div>Unknown configuration type</div>;
  }
};

DomainConfigurationInstructions.show = p => {
  getAntdModal().info({
    width: "80%",
    style: { maxWidth: "80%" },
    title: (
      <h2 className="text-2xl">
        <code>{p.domain}</code> configuration instructions
      </h2>
    ),
    content: <DomainConfigurationInstructions {...p} />,
  });
};

export const DomainsEditor: React.FC<
  { context: "site" | "workspace"; workspaceDomains?: string[] } & CustomWidgetProps<string[]>
> = ({ onChange, value: domains, workspaceDomains, context, disabled }) => {
  const [addValue, setAddValue] = useState<string | undefined>();
  const [addPending, setAddPending] = useState(false);
  const workspace = useWorkspace();
  const billing = useBilling();
  // JITSU-228: custom domains are Business and Enterprise. Resolved by the
  // server rather than from useBilling() — that is gated on
  // appConfig.billingEnabled, which is false on an EE install without Firebase,
  // where the server still enforces. Self-hosted consoles have no plans and the
  // endpoint allows everything there. Domains already configured stay listed and
  // removable below — only adding one is gated, which is what grandfathers a
  // workspace that had a domain before the gate existed.
  const entitlements = useEntitlements();
  const planTooLow = entitlements.customDomains === false;
  const add = async () => {
    if (disabled || entitlements.customDomains !== true) return;
    setAddPending(true);
    try {
      if (addValue?.includes("*") && context !== "workspace") {
        feedbackError("Wildcard domains are only allowed on Workspace level");
        return;
      }
      const available: DomainCheckResponse = await get(`/api/${workspace.id}/domain-check?domain=${addValue}`);
      if (!available.ok) {
        if (available.reason === "used_by_other_workspace") {
          feedbackError(
            <>
              Domain <code>{addValue}</code> is not available. It is used by other workspace. Contact{" "}
              <code>support@jitsu.com</code> if you think this is a mistake
            </>
          );
          return;
        } else if (available.reason === "invalid_domain_name") {
          feedbackError(
            <>
              Invalid domain name: <code>{addValue}</code>
            </>
          );
          return;
        }
      }
      const newVal = [...(domains ?? []), addValue as string];
      await onChange(newVal);
      setAddValue(undefined);
    } catch (e) {
      feedbackError(`Can't add domain ${addValue}`, { error: e });
    } finally {
      setAddPending(false);
    }
  };
  return (
    <div>
      {(workspaceDomains ?? []).filter(d => d.includes("*")).length > 0 && (
        <div className="mb-2 p-2.5 bg-background border rounded-lg text-text">
          The following wildcard domains are configured on the <WLink href={"/settings/domains"}>Workspace</WLink>{" "}
          level:
          <div className={"inline-block mt-1"}>
            {(workspaceDomains ?? [])
              .filter(d => d.includes("*"))
              .map(d => {
                return (
                  <code className={"ml-2"} key={d}>
                    {d}
                  </code>
                );
              })}
          </div>
          <div>Subdomains of these domains can be added without additional configuration.</div>
        </div>
      )}
      {entitlements.customDomains === null ? (
        <EntitlementStatus loading={entitlements.loading} retry={entitlements.retry} />
      ) : (
        <>
          {/* A plan without custom domains keeps the control on screen, locked, so a
              workspace that already has domains sees why it cannot add another instead
              of the control vanishing. The server refuses the add regardless. */}
          <div className="flex">
            <Input
              placeholder="subdomain.mywebsite.com"
              disabled={disabled || planTooLow}
              value={addValue}
              onChange={e => setAddValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  add();
                  e.preventDefault();
                }
              }}
            />
            {/* A disabled antd button does not emit the mouse events a Tooltip needs, so
                the tooltip sits on a wrapper. */}
            <Tooltip title={planTooLow ? domainsLockedTooltip(billing.enabled) : undefined}>
              <span className="ml-5 inline-block">
                <JitsuButton
                  requiredPermission={"editEntities"}
                  disabled={disabled || planTooLow || !addValue}
                  type={"primary"}
                  onClick={add}
                  loading={addPending}
                >
                  Add
                </JitsuButton>
              </span>
            </Tooltip>
          </div>
          {/* The tooltip alone is invisible on touch and to keyboard users, so the same
              reason is also shown inline. */}
          {planTooLow && (
            <div className="mt-2 text-textLight">
              Available on <b>Business</b> and <b>Enterprise</b>.{" "}
              {billing.enabled ? (
                <WLink href="/settings/billing">Upgrade</WLink>
              ) : (
                <span>Contact your workspace administrator to change the plan.</span>
              )}
            </div>
          )}
        </>
      )}
      <div className="mt-5">
        {(workspaceDomains ?? [])
          .filter(d => !d.includes("*"))
          .map(domain => {
            return (
              <div key={domain} className="mb-4">
                <CustomDomain domain={domain} workspaceDomain />
              </div>
            );
          })}
        {(domains ?? []).map(domain => {
          return (
            <div key={domain} className="mb-4">
              <CustomDomain
                domain={domain}
                removalIsFinal={planTooLow}
                deleteDomain={async () => {
                  const newVal = domains!.filter(d => d !== domain);
                  await onChange(newVal);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
