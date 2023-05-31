import React, { ReactNode } from "react";
import { useModalPrompt } from "../../lib/modal";
import { Select } from "antd";

export const MultiSelectWithCustomOptions: React.FC<{
  customOptions?: {
    prefix: string | undefined;
    name: string;
    prompt: string;
  };
  options: { name: ReactNode; id: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
}> = p => {
  const prompt = useModalPrompt();
  const predefinedOptionsIds = p.options.map(o => o.id);

  const [customOptions, setCustomOptions] = React.useState<string[]>(
    p.value.filter(id => !predefinedOptionsIds.includes(id))
  );
  const [selectedIds, setSelectedIds] = React.useState<string[]>(p.value);
  const [open, setOpen] = React.useState(false);
  return (
    <Select
      open={open}
      onDropdownVisibleChange={visible => setOpen(visible)}
      status={selectedIds.length > 0 ? undefined : "error"}
      value={selectedIds}
      mode="multiple"
      placeholder="Select at least one item"
      dropdownMatchSelectWidth={true}
      className="w-full"
      onSelect={async val => {
        if (val === "$custom") {
          setOpen(false);
          const customValue = await prompt.ask(p.customOptions?.prompt || "Enter custom event name");
          console.log("customValue", customValue);
          if (customValue) {
            setCustomOptions([...customOptions, customValue]);
            const newVal = [...selectedIds, customValue];
            p.onChange(newVal);
            setSelectedIds(newVal);
          }
        }
        setOpen(false);
      }}
      onChange={ids => {
        const newVal = ids.filter(id => id !== "$custom");
        setSelectedIds(newVal);
        p.onChange(newVal);
      }}
    >
      {p.options.map(o => (
        <Select.Option key={o.id} value={o.id}>
          {o.name}
        </Select.Option>
      ))}
      {customOptions.map(opt => (
        <Select.Option key={opt} value={opt}>
          {p.customOptions?.prefix ? `${p.customOptions?.prefix}: ${opt}` : opt}
        </Select.Option>
      ))}
      <Select.Option key="$custom" value="$custom">
        <span className={"text-textLight"}>{p.customOptions?.name || "Add custom..."}</span>
      </Select.Option>
    </Select>
  );
};
