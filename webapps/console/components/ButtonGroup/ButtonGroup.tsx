import { Dropdown, MenuProps, Tooltip, ButtonProps as AntButtonProps } from "antd";
import React from "react";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import styles from "./ButtonGroup.module.css";
import { useWorkspace, useWorkspaceRole } from "../../lib/context";
import { MoreHorizontal, MoreVertical } from "lucide-react";
import Link from "next/link";
import { hasPermission, WorkspacePermissionsType } from "../../lib/workspace-roles";

export type ButtonProps = Omit<AntButtonProps, "children" | "type"> & {
  href?: string;
  label?: React.ReactNode;
  collapsed?: boolean;
  // if label is not a string, tooltip text will be used for Tooltip
  tooltip?: string;
  onClick?: () => void;
  requiredPermission?: WorkspacePermissionsType;
};

export type ButtonGroupProps = {
  items: ButtonProps[];
  dotsButtonProps?: AntButtonProps;
  dotsOrientation?: "horizontal" | "vertical";
};

export const ButtonGroup: React.FC<ButtonGroupProps> = ({ items, dotsButtonProps, dotsOrientation = "vertical" }) => {
  const w = useWorkspace();
  const workspaceRole = useWorkspaceRole();
  const shownItems = items.filter(item => !item.collapsed);
  const dropdownItems: MenuProps["items"] = items
    .filter(item => item.collapsed)
    .map((item, i) => ({
      label: item.href ? (
        <Link prefetch={false} href={`/${w.slug || w.id}${item.href}`}>
          {item.label}
        </Link>
      ) : (
        item.label
      ),
      key: i,
      icon: item.icon,
      disabled:
        item.disabled ||
        (item.requiredPermission ? !hasPermission(workspaceRole.role, item.requiredPermission) : false),
      danger: item.danger,
      onClick: item.onClick,
    }));

  const totalItems = shownItems.length + (dropdownItems.length > 0 ? 1 : 0);

  return (
    <div className={styles.buttonGroup}>
      {shownItems.map((item, i) => (
        <Tooltip title={typeof item.label === "string" ? item.label : item.tooltip} key={i}>
          <JitsuButton
            {...item}
            key={i}
            ws={!!item.href}
            requiredPermission={item.requiredPermission}
            className={`${item.className || ""} ${styles.groupedButton} ${i === 0 ? styles.firstButton : ""} ${
              i === totalItems - 1 && dropdownItems.length === 0 ? styles.lastButton : ""
            } ${totalItems === 1 ? styles.onlyButton : ""}`.trim()}
          />
        </Tooltip>
      ))}
      {dropdownItems.length > 0 && (
        <Dropdown trigger={["click"]} menu={{ items: dropdownItems }}>
          <JitsuButton
            className={`text-lg font-bold ${styles.groupedButton} ${
              shownItems.length === 0 ? styles.onlyButton : styles.lastButton
            }`}
            icon={
              dotsOrientation === "vertical" ? (
                <MoreVertical className={"w-4 h-4"} />
              ) : (
                <MoreHorizontal className={"w-4 h-4"} />
              )
            }
            onClick={event => {
              event.preventDefault();
              event.stopPropagation(); // stop propagation main button
            }}
            {...dotsButtonProps}
          />
        </Dropdown>
      )}
    </div>
  );
};
