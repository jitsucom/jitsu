import React from "react";
import { DatePicker, Input, Select } from "antd";
import dayjs from "dayjs";

export type CustomWidgetProps<T> = {
  value: T | undefined;
  onChange: (value: T) => void;
};
export const DateEditor: React.FC<{ format: string } & CustomWidgetProps<string>> = props => {
  return (
    <DatePicker
      showTime={props.format.includes("HH")}
      format={props.format}
      style={{ width: "100%" }}
      value={props.value ? dayjs(props.value, props.format) : undefined}
      onChange={v => {
        props.onChange((v ?? dayjs()).format(props.format));
      }}
    />
  );
};

export function SelectEditor<T>(
  props: { options: { label: string; value: T }[]; className?: string } & CustomWidgetProps<T>
) {
  return (
    <Select
      className={props.className}
      style={{ width: "100%" }}
      value={props.value}
      showSearch={false}
      onChange={v => {
        props.onChange(v);
      }}
      options={props.options}
    />
  );
}

export const StringArray: React.FC<{ options?: string[] } & CustomWidgetProps<string[]>> = props => {
  return (
    <Select
      mode={!props.options || props.options.length == 0 ? "tags" : "multiple"}
      allowClear
      style={{ width: "100%" }}
      value={props.value}
      showSearch={false}
      showArrow={false}
      options={props.options?.map(o => ({ label: o, value: o }))}
      onChange={v => {
        props.onChange(v);
      }}
    />
  );
};

export const TextEditor: React.FC<{ rows?: number } & CustomWidgetProps<string>> = props => {
  if (props.rows && props.rows > 1) {
    return <Input.TextArea rows={props.rows} value={props.value} onChange={e => props.onChange(e.target.value)} />;
  } else {
    return <Input type="text" value={props.value} onChange={e => props.onChange(e.target.value)} />;
  }
};

export const NumberEditor: React.FC<CustomWidgetProps<number | undefined>> = props => {
  return (
    <Input
      type="number"
      value={props.value}
      onChange={e => {
        const v = parseInt(e.target.value);
        if (isNaN(v)) {
          props.onChange(undefined);
        } else {
          props.onChange(v);
        }
      }}
    />
  );
};

export const PasswordEditor: React.FC<CustomWidgetProps<string>> = props => {
  return (
    <Input.Password
      value={props.value}
      onChange={e => {
        props.onChange(e.target.value);
      }}
    />
  );
};
