import { Button, Dropdown, MenuProps, Tooltip } from "antd";
import React from "react";
import { JitsuButton, WJitsuButton } from "../JitsuButton/JitsuButton";
import { BaseButtonProps } from "antd/lib/button/button";
import styles from "./ButtonGroup.module.css";
import { useRouter } from "next/router";
import { useWorkspace, WorkspaceContext } from "../../lib/context";
import { MoreVertical } from "lucide-react";
import Link from "next/link";
import { MenuItemType } from "antd/es/menu/hooks/useItems";

const AntButtonGroup = Button.Group;

export type ButtonProps = Omit<BaseButtonProps, "children" | "type"> & {
  href?: string;
  label?: React.ReactNode;
  showLabel?: boolean;
  collapsed?: boolean;
  title?: string;
  onClick?: () => void;
};

export type ButtonGroupProps = {
  items: ButtonProps[];
};

function toMenuIten(w: WorkspaceContext, item: ButtonProps, i: number): MenuItemType {
  return item.href
    ? {
        label: (
          <Link prefetch={true} href={`/${w.slug || w.id}/${item.href}`}>
            {item.label}
          </Link>
        ),
        key: item.href,
        icon: item.icon,
        disabled: item.disabled,
        danger: item.danger,
      }
    : {
        label: item.label,
        key: i,
        icon: item.icon,
        disabled: item.disabled,
        danger: item.danger,
        onClick: item.onClick,
      };
}

export const ButtonGroup: React.FC<ButtonGroupProps> = ({ items }) => {
  const router = useRouter();
  const w = useWorkspace();
  const menuItems: MenuProps["items"] = items.map((item, i) =>
    item.onClick
      ? {
          label: (
            <Link prefetch={true} href={`/${w.slug || w.id}/${item.href}`}>
              {item.label}
            </Link>
          ),
          key: i,
          icon: item.icon,
          disabled: item.disabled,
          danger: item.danger,
        }
      : {
          label: item.label,
          key: i,
          icon: item.icon,
          disabled: item.disabled,
          anger: item.danger,
          onClick: item.onClick,
        }
  );
  const expandedItems = items.filter(item => !item.collapsed);
  const collapsedItems = items.filter(item => !!item.collapsed).map((item, i) => toMenuIten(w, item, i));

  return (
    <AntButtonGroup className={styles.buttonGroup}>
      {expandedItems.map((item, i) => {
        if (item.href) {
          return (
            <Tooltip title={!item.showLabel && typeof item.label === "string" ? item.label : undefined} key={i}>
              <WJitsuButton {...item} key={i} href={item.href}>
                {item.showLabel && item.label ? item.label : undefined}
              </WJitsuButton>
            </Tooltip>
          );
        }
        return (
          <Tooltip title={!item.showLabel && typeof item.label === "string" ? item.label : undefined} key={i}>
            <JitsuButton {...item} key={i}>
              {item.showLabel && item.label ? item.label : undefined}
            </JitsuButton>
          </Tooltip>
        );
      })}
      {collapsedItems.length > 0 && (
        <Dropdown trigger={["click"]} menu={{ items: collapsedItems }}>
          <JitsuButton className="text-lg font-bold p-0" icon={<MoreVertical className={"w-4 h-4"} />} />
        </Dropdown>
      )}
    </AntButtonGroup>
  );
};
