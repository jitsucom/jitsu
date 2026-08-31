import { Alert, Button, Checkbox, Modal, Skeleton } from "antd";
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { rpc } from "juava";
import { useWorkspace, useWorkspaceRole } from "../../lib/context";
import { get } from "../../lib/useApi";
import { useBilling } from "../Billing/BillingProvider";
import { ErrorCard } from "../GlobalError/GlobalError";
import { WJitsuButton } from "../JitsuButton/JitsuButton";
import { feedbackError, feedbackSuccess } from "../../lib/ui";
import {
  BACKUP_RETENTION_PRESET_DAYS,
  BackupRetentionState,
  formatBackupRetention,
  FREE_BACKUP_RETENTION_CAP_DAYS,
  getBackupRetentionCapDays,
  isBackupRetentionPreset,
} from "../../lib/shared/data-retention";
import { RetentionStagesPanel } from "./RetentionStagesPanel";

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
    <RetentionStagesPanel
      backupRetentionHours={parsed.retentionHours}
      backupSettings={
        <BackupRetentionEditor
          key={`${parsed.retentionHours}:${parsed.source}`}
          state={parsed}
          capDays={capDays}
          upgradeHref={onCustomPlan ? "/support" : "/settings/billing"}
          onSaved={next => queryClient.setQueryData(["backup-retention", workspace.id], next)}
        />
      }
    />
  );
};

type Option = {
  days: number;
  label: string;
  hint: string;
  /** Above the plan cap — visible, but not selectable. */
  premium: boolean;
};

const PremiumPill: React.FC<{}> = () => (
  <span className="bg-primary/10 text-primary inline-flex items-center gap-[3px] rounded-full px-[7px] py-0.5 text-[10px] font-bold tracking-wide">
    <Lock className="h-[9px] w-[9px]" strokeWidth={2.5} />
    PREMIUM
  </span>
);

export const BackupRetentionEditor: React.FC<{
  state: BackupRetentionState;
  capDays: number;
  upgradeHref: string;
  onSaved: (next: BackupRetentionState) => void;
}> = ({ state, capDays, upgradeHref, onSaved }) => {
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
    hint:
      days === 0
        ? "Nothing is archived or restorable."
        : days <= FREE_BACKUP_RETENTION_CAP_DAYS
        ? "Replay a short outage."
        : days < 90
        ? "Covers a month of issues."
        : "Replay a full quarter.",
    // The current value stays selectable even when it is above the cap (a free
    // workspace on the fleet default): re-selecting it is a no-op.
    premium: days > capDays && days !== currentDays,
  }));
  if (!isBackupRetentionPreset(currentDays)) {
    options.unshift({
      days: currentDays,
      label: formatBackupRetention(state.retentionHours),
      hint: "Custom window set by Jitsu.",
      premium: false,
    });
  }
  // The ceiling the CTA advertises is what the PLAN would unlock, not what is
  // selectable right now: a free workspace still on the 90-day fleet default
  // keeps 90 as its current value (so it isn't badged premium), but an upgrade
  // is still what buys the right to choose it.
  const abovePlanCap = BACKUP_RETENTION_PRESET_DAYS.filter(days => days > capDays);
  const upgradeTo = options.some(o => o.premium) ? Math.max(...abovePlanCap) : undefined;

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
    <div className="bg-background rounded-[10px] border border-neutral-100 p-5">
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

      <div className="mb-3.5 flex items-center justify-between gap-4">
        <div className="text-textLight text-[13px]">How long should backups be kept?</div>
        {upgradeTo && !state.locked && (
          <WJitsuButton
            type="primary"
            size="small"
            href={upgradeHref}
            icon={<Lock className="block h-3.5 w-3.5" />}
            className="whitespace-nowrap"
          >
            {upgradeHref === "/support" ? `Contact support for ${upgradeTo} days` : `Unlock up to ${upgradeTo} days`}
          </WJitsuButton>
        )}
      </div>

      <div
        role="radiogroup"
        aria-label="Backup retention"
        className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4"
      >
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
              className={`flex flex-col items-stretch gap-1 rounded-[10px] border px-3.5 py-3 text-left transition-colors ${
                isSelected ? "border-primary bg-primary/5" : "border-textDisabled bg-backgroundLight"
              } ${disabled ? "cursor-not-allowed opacity-60" : "hover:border-primaryLight cursor-pointer"}`}
            >
              <span className="flex items-center justify-between gap-1.5">
                <span className="text-textDark text-sm font-medium">{option.label}</span>
                {option.premium && <PremiumPill />}
                {isCurrent && !option.premium && <span className="text-textLight text-[11px]">current</span>}
              </span>
              <span className="text-textLight text-xs leading-[17px]">{option.hint}</span>
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
        <span className="text-textLight text-xs">Changes apply to the backup bucket within an hour.</span>
        <Button
          type="primary"
          loading={saving}
          disabled={!canEdit || !hasChanges || saving}
          onClick={() => (selected === 0 ? setAckOpen(true) : save())}
        >
          Save
        </Button>
      </div>

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
    </div>
  );
};
