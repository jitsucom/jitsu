import React, { useId, useState } from "react";
import { Select } from "antd";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "juava";
import { z } from "zod";
import { useWorkspace } from "../../lib/context";
import { EditorField } from "../ConfigObjectEditor/EditorField";

/** Fills both IDs atomically; manual credential fields below remain available. */
export function MicrosoftAccountSelector({
  destinationId,
  isNew,
  draftGrant,
  developerToken,
  authorized,
  accountId,
  disabled,
  onChange,
}: {
  destinationId: string;
  isNew: boolean;
  draftGrant?: string;
  developerToken?: string;
  authorized?: boolean;
  accountId?: string;
  disabled: boolean;
  onChange: (accountId: string, customerId: string) => void;
}) {
  const workspace = useWorkspace();
  const fieldId = useId();
  const [requested, setRequested] = useState(false);
  const query = useQuery({
    queryKey: ["microsoft-accounts", workspace.id, destinationId, isNew, authorized, developerToken],
    enabled: requested && (!isNew || !!(draftGrant && authorized)) && !disabled,
    queryFn: async ({ signal }) =>
      z
        .object({
          options: z.array(z.object({ value: z.string(), label: z.string(), customerId: z.string() })),
          truncated: z.boolean().optional(),
        })
        .parse(
          isNew
            ? await rpc(`/api/${workspace.id}/reverse-etl/microsoft-draft`, {
                method: "POST",
                body: { action: "accounts", grant: draftGrant, developerToken: developerToken || undefined },
                signal,
              })
            : await rpc(`/api/${workspace.id}/reverse-etl/options`, {
                query: { destinationId, kind: "microsoft-account" },
                signal,
              })
        ),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  return (
    <EditorField
      id={fieldId}
      label="Microsoft advertising account"
      help={
        <div id={`${fieldId}-help`}>
          <p>
            {isNew && !authorized
              ? "Authorize Microsoft above to choose an account before saving. Manual IDs are also supported."
              : "Selecting an account fills both IDs below. Save to apply the selection; manual IDs are also supported."}
          </p>
          {query.isError && (
            <p className="text-warning mt-1">
              {query.error instanceof Error ? query.error.message : "Account lookup unavailable."}
            </p>
          )}
          {query.data?.truncated && (
            <p className="mt-1">Only the first 1,000 accounts are listed. Enter IDs manually for other accounts.</p>
          )}
        </div>
      }
    >
      <Select
        id={fieldId}
        aria-describedby={`${fieldId}-help`}
        className="w-full"
        showSearch
        optionFilterProp="label"
        disabled={disabled || (isNew && !(draftGrant && authorized))}
        loading={query.isFetching}
        value={accountId || undefined}
        placeholder="Choose an account to fill account and customer IDs"
        options={query.data?.options}
        onFocus={() => setRequested(true)}
        onChange={(value, option) => {
          if (!Array.isArray(option) && option?.customerId) onChange(value, option.customerId);
        }}
      />
    </EditorField>
  );
}
