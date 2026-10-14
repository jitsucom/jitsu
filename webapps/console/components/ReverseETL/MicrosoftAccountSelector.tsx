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
  accountId,
  disabled,
  onChange,
}: {
  destinationId: string;
  isNew: boolean;
  accountId?: string;
  disabled: boolean;
  onChange: (accountId: string, customerId: string) => void;
}) {
  const workspace = useWorkspace();
  const fieldId = useId();
  const [requested, setRequested] = useState(false);
  const query = useQuery({
    queryKey: ["microsoft-accounts", workspace.id, destinationId],
    enabled: requested && !isNew && !disabled,
    queryFn: async ({ signal }) =>
      z
        .object({
          options: z.array(z.object({ value: z.string(), label: z.string(), customerId: z.string() })),
          truncated: z.boolean().optional(),
        })
        .parse(
          await rpc(`/api/${workspace.id}/reverse-etl/options`, {
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
            {isNew
              ? "Authorize and save the destination first; you can leave account/customer IDs empty, then reopen it to choose an account."
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
        disabled={disabled || isNew}
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
