import React, { useState } from "react";
import { DatePicker, Input, Select, Button } from "antd";
import { EditOutlined, EyeInvisibleOutlined, EyeOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { useWorkspaceRole } from "../../lib/context";
import { MASKED_SECRET } from "../../lib/schema/destinations";
import styles from "./Editors.module.css";
dayjs.extend(utc);

export type CustomWidgetProps<T> = {
  value: T | undefined;
  onChange: (value: T) => Promise<void> | void;
  disabled?: boolean;
};
export const DateEditor: React.FC<{ format: string } & CustomWidgetProps<string>> = props => {
  return (
    <DatePicker
      showTime={props.format.includes("HH")}
      format={props.format}
      disabled={props.disabled}
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
      disabled={props.disabled}
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
      disabled={props.disabled}
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

export const TextEditor: React.FC<{ rows?: number; placeholder?: string } & CustomWidgetProps<string>> = props => {
  if (props.rows && props.rows > 1) {
    return (
      <Input.TextArea
        disabled={props.disabled}
        rows={props.rows}
        value={props.value}
        onChange={e => props.onChange(e.target.value)}
      />
    );
  } else {
    return (
      <Input
        disabled={props.disabled}
        placeholder={props.placeholder}
        type="text"
        value={props.value}
        onChange={e => props.onChange(e.target.value)}
      />
    );
  }
};

export const NumberEditor: React.FC<CustomWidgetProps<number | undefined> & { max?: number; min?: number }> = props => {
  return (
    <Input
      type="number"
      disabled={props.disabled}
      value={props.value}
      min={props.min}
      max={props.max}
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

export const PasswordEditor: React.FC<CustomWidgetProps<string> & { rows?: number; options?: any }> = props => {
  const userRole = useWorkspaceRole();
  const canEdit = !props.disabled && userRole.editEntities;

  // Check if the current value is masked
  const isMasked = props.value === MASKED_SECRET;

  // Track if we're in edit mode and the local value
  const [isEditMode, setIsEditMode] = useState(!isMasked);
  const [localValue, setLocalValue] = useState(props.value || "");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  // // Update local value when props change, but only if not in edit mode
  // useEffect(() => {
  //   if (!isEditMode && !hasUserInput) {
  //     setLocalValue(props.value || "");
  //   }
  // }, [props.value, isEditMode, hasUserInput]);

  // Get rows from either direct prop or options
  const rows = props.rows || props.options?.rows;

  const handleEdit = () => {
    if (isMasked) {
      setLocalValue("");
      setIsEditMode(true);
    }
  };

  const handleChange = (value: string) => {
    setLocalValue(value);
    props.onChange(value);
  };

  if (rows && rows > 1) {
    // For multiline passwords, create a custom implementation
    return (
      <div style={{ position: "relative" }}>
        <Input.TextArea
          rows={rows}
          autoComplete={"new-password"}
          value={localValue}
          onChange={e => handleChange(e.target.value)}
          className={!isEditMode || !isPasswordVisible ? styles.passwordTextareaMasked : styles.passwordTextareaVisible}
          placeholder={
            canEdit && isEditMode
              ? isMasked
                ? "Enter new password or secret..."
                : "Enter password or secret..."
              : undefined
          }
          disabled={props.disabled || !canEdit || !isEditMode}
        />
        {canEdit && (
          <>
            {isMasked && !isEditMode ? (
              <Button
                type="text"
                icon={<EditOutlined className={"w-3.5 h-3.5"} style={{ color: "#8c8c8c" }} />}
                onClick={handleEdit}
                className={styles.passwordExtraButton}
                title="Edit password"
              />
            ) : (
              <Button
                type="text"
                icon={
                  isPasswordVisible ? (
                    <EyeOutlined className={"w-3.5 h-3.5"} style={{ color: "#8c8c8c" }} />
                  ) : (
                    <EyeInvisibleOutlined className={"w-3.5 h-3.5"} style={{ color: "#8c8c8c" }} />
                  )
                }
                onClick={() => setIsPasswordVisible(!isPasswordVisible)}
                className={styles.passwordExtraButton}
                title={isPasswordVisible ? "Hide password" : "Show password"}
              />
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: "relative", display: "inline-block", width: "100%" }}>
      <Input.Password
        value={localValue}
        autoComplete={"new-password"}
        onChange={e => handleChange(e.target.value)}
        visibilityToggle={canEdit && isEditMode}
        disabled={props.disabled || !canEdit || !isEditMode}
        placeholder={canEdit && isEditMode ? (isMasked ? "Enter new password..." : "Enter password...") : undefined}
        className={styles.passwordInput}
      />
      {canEdit && isMasked && !isEditMode && (
        <Button
          type="text"
          icon={<EditOutlined className={"w-3.5 h-3.5"} style={{ color: "#8c8c8c" }} />}
          onClick={handleEdit}
          className={styles.passwordExtraButton}
          title="Edit password"
        />
      )}
    </div>
  );
};
