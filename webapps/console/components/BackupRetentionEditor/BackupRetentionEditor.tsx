import { Alert, Button, Checkbox, Modal, Skeleton } from "antd";
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Lock } from "lucide-react";
import { rpc } from "juava";
import { useWorkspace, useWorkspaceRole } from "../../lib/context";
import { get } from "../../lib/useApi";
import { useBilling } from "../Billing/BillingProvider";
import { ErrorCard } from "../GlobalError/GlobalError";
import { feedbackError, feedbackSuccess } from "../../lib/ui";
import {
  BACKUP_RETENTION_PRESET_DAYS,
  BackupRetentionState,
  formatBackupRetention,
  FREE_BACKUP_RETENTION_CAP_DAYS,
  getBackupRetentionCapDays,
  isBackupRetentionPreset,
} from "../../lib/shared/data-retention";
import { PipelineRetentionList } from "./PipelineRetentionList";

export const BackupRetentionEditorLoader: React.FC<{}> = () => {
  const workspace = useWorkspace();
  const billing = useBilling();
  const queryClient = useQueryClient();
  const state = useQuery(
    ["backup-retention", workspace.id],
    () => get(`/api/workspace/${workspace.id}/backup-retention`),
    { retry: false, cacheTime: 0, refetchOnWindowFocus: false }
  );
  if (state.isLoading || billing.loading) {
    return <Skeleton active={true} />;
  }
  if (state.isError) {
    return <ErrorCard error={state.error} />;
  }
  const parsed = BackupRetentionState.parse(state.data);
  // Unknown plan (billing unreachable) => the free cap. Conservative on purpose:
  // the server verifies the plan on save anyway, and showing "unlocked" only to
  // fail the save is worse than a transient lock.
  const capDays = billing.enabled ? getBackupRetentionCapDays(billing.settings) : FREE_BACKUP_RETENTION_CAP_DAYS;
  const onCustomPlan = !!(billing.enabled && (billing.settings?.custom || billing.settings?.customBilling));
  return (
    // The pipeline list is read-only reference; the Recovery panel beside it is
    // the only control on the page. Stacks below `lg`.
    <div className="grid items-start gap-10 lg:grid-cols-[1fr_25rem] lg:gap-14">
      <PipelineRetentionList />
      <BackupRetentionEditor
        key={`${parsed.retentionHours}:${parsed.source}`}
        state={parsed}
        capDays={capDays}
        upgradeHref={onCustomPlan ? "/support" : "/settings/billing"}
        upgradeLabel={onCustomPlan ? "Contact support" : "Compare plans"}
        onSaved={next => queryClient.setQueryData(["backup-retention", workspace.id], next)}
      />
    </div>
  );
};

type Option = {
  days: number;
  label: string;
  /** Above the plan cap — visible, but not selectable. */
  premium: boolean;
};

export const BackupRetentionEditor: React.FC<{
  state: BackupRetentionState;
  capDays: number;
  upgradeHref: string;
  upgradeLabel: string;
  onSaved: (next: BackupRetentionState) => void;
}> = ({ state, capDays, upgradeHref, upgradeLabel, onSaved }) => {
  const workspace = useWorkspace();
  const role = useWorkspaceRole();
  const currentDays = state.retentionHours / 24;
  const [selected, setSelected] = useState<number>(currentDays);
  const [saving, setSaving] = useState(false);
  const [ackOpen, setAckOpen] = useState(false);
  const [acked, setAcked] = useState(false);

  const canEdit = role.editEntities && !state.locked;
  const hasChanges = selected !== currentDays;
  const options: Option[] = BACKUP_RETENTION_PRESET_DAYS.map(days => ({
    days,
    label: days === 0 ? "No backups" : `${days} days`,
    // The current value stays selectable even when it is above the cap (a free
    // workspace on the fleet default): re-selecting it is a no-op.
    premium: days > capDays && days !== currentDays,
  }));
  if (!isBackupRetentionPreset(currentDays)) {
    options.unshift({ days: currentDays, label: formatBackupRetention(state.retentionHours), premium: false });
  }
  // Shown whenever the plan cannot reach the longest window — including for a
  // free workspace still on the 90-day fleet default, where 90 is its current
  // value (so not badged premium) but an upgrade is what buys the right to
  // keep choosing it.
  const showUpgradeLink = capDays < Math.max(...BACKUP_RETENTION_PRESET_DAYS) && !state.locked;

  const save = async (acknowledgeDataLoss?: boolean) => {
    setSaving(true);
    try {
      const next = await rpc(`/api/workspace/${workspace.id}/backup-retention`, {
        method: "PUT",
        body: { retentionDays: selected, acknowledgeDataLoss },
      });
      onSaved(BackupRetentionState.parse(next));
      feedbackSuccess(
        selected === 0 ? "Backups turned off" : `Backups will be kept for ${formatBackupRetention(selected * 24)}`
      );
    } catch (e: any) {
      feedbackError("Failed to save backup retention", { error: e });
    } finally {
      setSaving(false);
      setAckOpen(false);
      setAcked(false);
    }
  };

  return (
    <aside aria-labelledby="backup-retention" className="bg-primary/5 border-primary/20 rounded-xl border p-6">
      <div className="text-primary text-[11px] font-semibold uppercase tracking-[0.06em]">Recovery</div>
      <h2 id="backup-retention" className="text-textDark mb-1 mt-2.5 text-lg font-semibold">
        Backup retention
      </h2>
      <p className="text-textLight mb-[18px] text-[13px] leading-[1.5]">
        A raw copy of your events — the only thing Jitsu can restore a destination from if it fails or loses data.
      </p>

      {state.locked && (
        <Alert
          className="mb-4"
          type="info"
          showIcon
          message="Backups are turned off for this workspace by Jitsu"
          description="Contact support if you'd like to turn them back on."
        />
      )}
      {!role.editEntities && !state.locked && (
        <Alert className="mb-4" type="info" showIcon message="Only workspace editors can change the backup window" />
      )}

      <div role="radiogroup" aria-label="Backup retention" className="grid gap-2">
        {options.map(option => {
          const isSelected = option.days === selected;
          const isCurrent = option.days === currentDays;
          const disabled = !canEdit || saving || option.premium;
          return (
            <button
              key={option.days}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => setSelected(option.days)}
              className={`bg-backgroundLight flex w-full items-center gap-3 rounded-lg border px-3.5 py-3 text-left text-sm transition-colors ${
                isSelected ? "border-primary ring-primary ring-1 ring-inset" : "border-textDisabled"
              } ${disabled ? "cursor-not-allowed" : "hover:border-primaryLight cursor-pointer"}`}
            >
              <span
                aria-hidden
                className={`box-border h-4 w-4 flex-none rounded-full ${
                  isSelected ? "border-[5px] border-primary" : "border-[1.5px] border-neutral-300"
                }`}
              />
              <span
                className={`flex-1 ${option.premium ? "text-textLight" : "text-textDark"} ${
                  isSelected ? "font-medium" : ""
                }`}
              >
                {option.label}
              </span>
              {option.premium ? (
                <span className="text-textLight inline-flex items-center gap-1 text-xs">
                  <Lock className="block h-3 w-3" />
                  Premium
                </span>
              ) : (
                isCurrent && <span className="text-primary text-xs font-semibold">Current</span>
              )}
            </button>
          );
        })}
      </div>

      {hasChanges && selected === 0 && (
        <Alert
          className="mt-3.5"
          type="warning"
          showIcon
          message="No recovery copy"
          description="With backups off there is nothing to restore from — if a destination or warehouse loses data, those events cannot be recovered. Existing backups are deleted."
        />
      )}
      {hasChanges && selected > 0 && selected < currentDays && (
        <Alert
          className="mt-3.5"
          type="warning"
          showIcon
          message={`Backups older than ${selected} days will be deleted`}
          description="The shorter window applies to existing backups too. This cannot be undone."
        />
      )}
      {hasChanges && currentDays === 0 && selected > 0 && (
        <Alert
          className="mt-3.5"
          type="info"
          showIcon
          message="Backups start from now"
          description="Events received while backups were off were not archived and cannot be recovered."
        />
      )}

      <div className="mt-4 flex items-center justify-between gap-4">
        {showUpgradeLink && (
          <Link className="text-[13px] font-medium" href={`/${workspace.slugOrId}${upgradeHref}`}>
            {upgradeLabel}
          </Link>
        )}
        <Button
          className="ml-auto"
          type="primary"
          loading={saving}
          disabled={!canEdit || !hasChanges || saving}
          onClick={() => (selected === 0 ? setAckOpen(true) : save())}
        >
          {hasChanges ? "Save changes" : "Save"}
        </Button>
      </div>
      <p className="text-textLight mt-3 text-xs">Takes effect within an hour.</p>

      <Modal
        open={ackOpen}
        title="Turn off event backups?"
        okText="Turn off backups"
        okButtonProps={{ danger: true, disabled: !acked, loading: saving }}
        onOk={() => save(true)}
        onCancel={() => {
          setAckOpen(false);
          setAcked(false);
        }}
      >
        <p>
          Jitsu will stop archiving events for <b>{workspace.name}</b> and delete the existing backups. There will be no
          recovery copy: if a destination or warehouse fails or loses data, those events cannot be restored.
        </p>
        <Checkbox className="mt-4" checked={acked} onChange={e => setAcked(e.target.checked)}>
          I understand that events cannot be recovered without backups
        </Checkbox>
      </Modal>
    </aside>
  );
};
