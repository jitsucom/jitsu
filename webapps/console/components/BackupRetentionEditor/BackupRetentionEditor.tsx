import { Alert, Button, Checkbox, Modal, Skeleton } from "antd";
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckOutlined } from "@ant-design/icons";
import { Lock, Unlock } from "lucide-react";
import Link from "next/link";
import { rpc } from "juava";
import { useWorkspace, useWorkspaceRole } from "../../lib/context";
import { get } from "../../lib/useApi";
import { useBilling } from "../Billing/BillingProvider";
import { PremiumBadge } from "../Billing/PremiumBadge";
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
          planName={billing.enabled ? billing.settings?.planName || billing.settings?.planId : undefined}
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
  description: string;
  /** Above the plan cap — visible, but not selectable. */
  premium: boolean;
  /** Not one of the presets: set by an admin, shown as the current value only. */
  custom: boolean;
};

export const BackupRetentionEditor: React.FC<{
  state: BackupRetentionState;
  capDays: number;
  planName?: string;
  upgradeHref: string;
  onSaved: (next: BackupRetentionState) => void;
}> = ({ state, capDays, planName, upgradeHref, onSaved }) => {
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
    description:
      days === 0
        ? "Events are not archived. Nothing can be restored."
        : days <= FREE_BACKUP_RETENTION_CAP_DAYS
        ? "Enough to replay a short outage."
        : days < 90
        ? "Covers a month of destination or warehouse issues."
        : "Maximum self-serve window. Replay a full quarter.",
    premium: days > capDays,
    custom: false,
  }));
  if (!isBackupRetentionPreset(currentDays)) {
    options.unshift({
      days: currentDays,
      label: formatBackupRetention(state.retentionHours),
      description: "Custom window set by Jitsu for this workspace.",
      premium: false,
      custom: true,
    });
  }
  const anyPremium = options.some(o => o.premium);

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

  // Rendered nested under the "Backups" row of RetentionStagesPanel — no card
  // chrome or heading of its own; the row is the heading.
  return (
    <div className="pt-3">
      <div className="text-textLight mb-4 text-sm">
        Choose how long backups are kept; older backups are deleted automatically.{" "}
        <Link
          className="font-semibold"
          href="https://docs.jitsu.com/features/event-backups"
          target="_blank"
          rel="noopener noreferrer"
        >
          Read the docs
        </Link>
      </div>
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
      <div role="radiogroup" aria-label="Backup retention" className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {options.map(option => {
          const isSelected = option.days === selected;
          const isCurrent = option.days === currentDays;
          // The current value stays selectable even when it is above the cap
          // (a free workspace on the fleet default): re-selecting it is a no-op.
          const disabled = !canEdit || saving || (option.premium && !isCurrent);
          return (
            <button
              key={option.days}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => setSelected(option.days)}
              className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                isSelected ? "border-primary bg-primary/5" : "border-textDisabled"
              } ${disabled ? "cursor-not-allowed opacity-70" : "hover:border-primaryLight"}`}
            >
              <span
                aria-hidden
                className={`mt-1 h-4 w-4 shrink-0 rounded-full border ${
                  isSelected ? "border-primary bg-primary" : "border-textLight"
                }`}
              />
              <span className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  {option.label}
                  {isCurrent && <span className="text-textLight text-xs font-normal">current</span>}
                  {option.premium && <PremiumBadge />}
                </span>
                <span className="text-textLight text-sm">{option.description}</span>
              </span>
            </button>
          );
        })}
      </div>
      {anyPremium && !state.locked && (
        <Alert
          className="mt-4"
          type="info"
          icon={<Lock className="h-5 w-5" />}
          showIcon
          message="Keep backups for up to 90 days"
          description={
            <div>
              <div>
                {planName ? (
                  <>
                    Your <b className="uppercase">{planName}</b> plan
                  </>
                ) : (
                  "Your plan"
                )}{" "}
                includes up to {capDays} days of event backups. Longer windows let you replay events after a destination
                outage that went unnoticed for weeks.
              </div>
              <div className="mt-3">
                <WJitsuButton icon={<Unlock className="h-4 w-4" />} type="primary" href={upgradeHref}>
                  {upgradeHref === "/support" ? "Contact support" : "Upgrade plan"}
                </WJitsuButton>
              </div>
            </div>
          }
        />
      )}
      {hasChanges && selected === 0 && (
        <Alert
          className="mt-4"
          type="warning"
          showIcon
          message="No recovery copy"
          description="With backups off, Jitsu keeps no copy of your events beyond the other pipeline stages listed above. If a destination or warehouse fails or loses data, those events cannot be recovered. Existing backups are deleted."
        />
      )}
      {hasChanges && selected > 0 && selected < currentDays && (
        <Alert
          className="mt-4"
          type="warning"
          showIcon
          message={`Backups older than ${selected} days will be deleted`}
          description="The shorter window applies to existing backups too. Deleted backups cannot be restored."
        />
      )}
      {hasChanges && currentDays === 0 && selected > 0 && (
        <Alert
          className="mt-4"
          type="info"
          showIcon
          message="Backups start from now"
          description="Events received while backups were off were not archived and cannot be recovered."
        />
      )}
      <div className="text-textLight mt-4 flex items-center justify-between gap-4 text-sm">
        <span>Changes are applied to the backup bucket within an hour.</span>
        <Button
          type="primary"
          icon={<CheckOutlined />}
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
