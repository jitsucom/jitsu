import React, { useId, useState } from "react";
import { Select, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "juava";
import { useWorkspace } from "../../lib/context";
import { EditorField } from "./EditorField";
import {
  AccountDiscoveryProvider,
  DestinationAccount,
  DestinationAccounts,
} from "../../lib/schema/destination-accounts";

/** Fills both IDs atomically; manual credential fields below remain available. */
export function OAuthAccountSelector({
  provider,
  destinationId,
  isNew,
  draftGrant,
  developerToken,
  authorized,
  accountId,
  customerId,
  loginCustomerId,
  authorizationRevision = 0,
  disabled,
  onChange,
}: {
  provider: AccountDiscoveryProvider;
  destinationId: string;
  isNew: boolean;
  draftGrant?: string;
  developerToken?: string;
  authorized?: boolean;
  accountId?: string;
  customerId?: string;
  loginCustomerId?: string;
  authorizationRevision?: number;
  disabled: boolean;
  onChange: (account: DestinationAccount) => void;
}) {
  const workspace = useWorkspace();
  const fieldId = useId();
  const [requested, setRequested] = useState(false);
  const google = provider === "google-ads";
  const label = google ? "Google Ads account" : "Microsoft advertising account";
  const query = useQuery({
    queryKey: [
      "destination-accounts",
      workspace.id,
      destinationId,
      provider,
      isNew,
      authorized,
      developerToken,
      authorizationRevision,
    ],
    enabled: requested && (!isNew || !!(draftGrant && authorized)) && !disabled,
    queryFn: async ({ signal }) =>
      DestinationAccounts.parse(
        isNew
          ? await rpc(`/api/${workspace.id}/destination-accounts`, {
              method: "POST",
              body: {
                action: "draft-accounts",
                provider,
                grant: draftGrant,
                developerToken: developerToken || undefined,
              },
              signal,
            })
          : await rpc(`/api/${workspace.id}/destination-accounts`, {
              method: "POST",
              body: { action: "saved-accounts", provider, destinationId },
              signal,
            })
      ),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const selectedValue = google
    ? customerId
      ? `${customerId.replace(/-/g, "")}:${(loginCustomerId || "").replace(/-/g, "")}`
      : undefined
    : accountId || undefined;
  const selectedLabel =
    query.data?.options.find(option => option.value === selectedValue)?.label ||
    (google ? `${customerId}${loginCustomerId ? ` · manager ${loginCustomerId}` : ""}` : accountId);
  return (
    <EditorField
      id={fieldId}
      label={label}
      help={
        <div id={`${fieldId}-help`}>
          <p>
            {isNew && !authorized
              ? "Authorize above to choose an account before saving. Manual IDs are also supported."
              : google
              ? "Selecting an account fills Customer ID and Manager ID below. Direct access clears Manager ID. Manual IDs are also supported."
              : "Selecting an account fills both IDs below. Save to apply the selection; manual IDs are also supported."}
          </p>
          {query.isError && (
            <p className="text-warning mt-1">
              {query.error instanceof Error ? query.error.message : "Account lookup unavailable."}
            </p>
          )}
          {query.data?.truncated && (
            <p className="mt-1">Account discovery reached its limit. Enter IDs manually for accounts not listed.</p>
          )}
          {query.data?.partial && (
            <p className="mt-1">Some accounts could not be loaded. Check permissions or enter IDs manually.</p>
          )}
        </div>
      }
    >
      <Select
        id={fieldId}
        aria-describedby={`${fieldId}-help`}
        aria-busy={query.isFetching}
        className="w-full"
        showSearch
        labelInValue
        optionFilterProp="label"
        disabled={disabled || (isNew && !(draftGrant && authorized))}
        loading={query.isFetching}
        notFoundContent={
          query.isFetching ? (
            <div role="status" className="flex items-center justify-center gap-2 py-3">
              <Spin size="small" /> Loading accounts…
            </div>
          ) : query.isError ? (
            "Unable to load accounts. See details below."
          ) : query.data ? (
            query.data.options.length ? (
              "No matching accounts."
            ) : query.data.partial || query.data.truncated ? (
              "No accounts loaded. See details below."
            ) : (
              "No accounts found."
            )
          ) : (
            "Waiting to load accounts…"
          )
        }
        value={selectedValue ? { value: selectedValue, label: selectedLabel } : undefined}
        placeholder="Choose an advertising account"
        options={query.data?.options}
        onFocus={() => setRequested(true)}
        onDropdownVisibleChange={open => {
          if (open) setRequested(true);
        }}
        onChange={(value, option) => {
          if (!Array.isArray(option) && option?.customerId) onChange(option);
        }}
      />
    </EditorField>
  );
}
