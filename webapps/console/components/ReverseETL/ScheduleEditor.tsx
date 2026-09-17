import React, { useState } from "react";
import { Input, Select } from "antd";

const presets = [
  { value: "", label: "Manual only" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 */6 * * *", label: "Every 6 hours" },
  { value: "0 0 * * *", label: "Daily at midnight" },
];
const custom = "custom";

/** A single controlled form value: presets and custom cron both save the actual cron string. */
export function ScheduleEditor({
  value = "",
  onChange,
  id,
}: {
  value?: string;
  onChange?: (value: string) => void;
  id?: string;
}) {
  const [editingCustom, setEditingCustom] = useState(false);
  const isCustom = editingCustom || !presets.some(preset => preset.value === value);
  return (
    <div className="space-y-3">
      <Select
        id={id}
        aria-label="Schedule frequency"
        className="w-full"
        value={isCustom ? custom : value}
        options={[...presets, { value: custom, label: "Custom cron expression" }]}
        onChange={next => {
          setEditingCustom(next === custom);
          if (next !== custom) onChange?.(next);
        }}
      />
      {isCustom && (
        <Input
          aria-label="Cron schedule"
          value={value}
          onChange={event => onChange?.(event.target.value)}
          placeholder="0 0 * * *"
        />
      )}
    </div>
  );
}
