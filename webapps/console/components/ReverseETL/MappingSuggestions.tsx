import React, { useEffect, useRef, useState } from "react";
import { Button, Collapse, Modal, Select, Tag, Tooltip } from "antd";
import { rpc } from "juava";
import type { ReverseEditorOptions, ReverseStreamEditor } from "@jitsu/protocols/reverse-etl-editor";
import type { WarehouseColumn } from "@jitsu/warehouse-query/src/schema";
import {
  applyMappingSuggestions,
  mappingTargets,
  MappingSuggestions as Result,
  type MappingCandidate,
} from "../../lib/reverse-mapping-suggestions";
import { Failure } from "./shared";

export function MappingSuggestions({
  workspaceId,
  modelId,
  destinationId,
  stream,
  options,
  columns,
  disabled,
  onApply,
}: {
  workspaceId: string;
  modelId: string;
  destinationId: string;
  stream: ReverseStreamEditor;
  options: ReverseEditorOptions;
  columns: WarehouseColumn[];
  disabled: boolean;
  onApply(mapping: Record<string, string>): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<Result>();
  const [selections, setSelections] = useState<Record<string, MappingCandidate | undefined>>({});
  const abort = useRef<AbortController>();
  useEffect(() => () => abort.current?.abort(), []);
  const targets = mappingTargets(stream, options);
  if (!targets.length) return null;
  const unmatched = result?.suggestions.filter(s => s.noMatch && s.confidence >= 0.8) ?? [];
  const renderSuggestion = (s: Result["suggestions"][number]) => (
    <div key={s.id}>
      <div className="flex items-center justify-between mb-1">
        <label htmlFor={`suggest-${s.id}`} className="font-medium">
          {s.label}
        </label>
        <Tooltip
          title={`Confidence in ${s.noMatch ? "no suitable match" : "the selected candidate"}: ${Math.round(
            s.confidence * 100
          )}%. This measures model certainty, not verified accuracy.`}
        >
          <Tag color={s.recommended ? "blue" : s.noMatch && s.confidence >= 0.8 ? undefined : "orange"}>
            {s.recommended ? "Suggested" : s.noMatch && s.confidence >= 0.8 ? "No match" : "Needs review"}
          </Tag>
        </Tooltip>
      </div>
      <Select
        id={`suggest-${s.id}`}
        className="w-full"
        allowClear
        disabled={disabled || !s.alternatives.length}
        placeholder={s.alternatives.length ? "Leave unmapped or choose an alternative" : "No suitable column"}
        value={
          selections[s.id]
            ? s.alternatives.findIndex(c => c.key === selections[s.id]?.key && c.column === selections[s.id]?.column)
            : undefined
        }
        options={s.alternatives.map((c, index) => ({
          value: index,
          label: `${c.column}${c.format ? ` (${c.format === "sha256" ? "SHA-256" : "Raw"})` : ""}`,
        }))}
        onChange={index =>
          setSelections(current => ({
            ...current,
            [s.id]: index === undefined ? undefined : s.alternatives[index],
          }))
        }
      />
    </div>
  );
  return (
    <div className="mb-3">
      <div className="flex items-center gap-3">
        <Button
          disabled={disabled || !modelId || !columns.length}
          loading={busy}
          onClick={async () => {
            abort.current?.abort();
            const controller = new AbortController();
            abort.current = controller;
            setBusy(true);
            setError(undefined);
            try {
              const response = Result.parse(
                await rpc(`/api/${workspaceId}/reverse-etl/suggest-mappings`, {
                  method: "POST",
                  body: {
                    modelId,
                    destinationId,
                    stream: stream.id,
                    mode: options.mode,
                    mapping: options.mapping,
                    streamOptions: options.streamOptions,
                  },
                  signal: controller.signal,
                })
              );
              if (controller.signal.aborted) return;
              if (
                JSON.stringify(response.columns.map(c => [c.name, c.type])) !==
                JSON.stringify(columns.map(c => [c.name, c.type]))
              )
                throw new Error("Model columns changed. Reload the model columns before requesting suggestions again.");
              setResult(response);
              setSelections(Object.fromEntries(response.suggestions.map(s => [s.id, s.recommended ?? undefined])));
            } catch (e) {
              if (!controller.signal.aborted) setError(e);
            } finally {
              if (!controller.signal.aborted) setBusy(false);
            }
          }}
        >
          Suggest mappings
        </Button>
        <span className="text-xs text-textSecondary">Based on column names and types only.</span>
      </div>
      <Failure error={error} />
      <Modal
        title="Review suggested mappings"
        open={!!result}
        width={720}
        onCancel={() => setResult(undefined)}
        okText="Apply selected mappings"
        okButtonProps={{ disabled: disabled || !Object.values(selections).some(Boolean) }}
        onOk={() => {
          onApply(
            applyMappingSuggestions(
              stream,
              options,
              columns,
              Object.values(selections).filter((c): c is MappingCandidate => !!c)
            )
          );
          setResult(undefined);
        }}
      >
        <p>
          Review before applying. Existing mappings are kept. Uncertain matches need your selection; confidence does not
          guarantee correctness.
        </p>
        <div className="max-h-96 overflow-y-auto space-y-4">
          {result?.suggestions.filter(s => !unmatched.includes(s)).map(renderSuggestion)}
          {!!unmatched.length && (
            <Collapse
              items={[
                {
                  key: "unmatched",
                  label: `Fields without a match (${unmatched.length})`,
                  children: <div className="space-y-4">{unmatched.map(renderSuggestion)}</div>,
                },
              ]}
            />
          )}
        </div>
      </Modal>
    </div>
  );
}
