import { Button, Dropdown, MenuProps, Tooltip } from "antd";
import React from "react";
import { JitsuButton, WJitsuButton } from "../JitsuButton/JitsuButton";
import { BaseButtonProps } from "antd/lib/button/button";
import styles from "./ButtonGroup.module.css";
import { useRouter } from "next/router";
import { useWorkspace } from "../../lib/context";
import JLucideIcon from "../Icons/JLucideIcon";

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
  collapseLast?: number;
};

export const ButtonGroup: React.FC<ButtonGroupProps> = ({ items, collapseLast }) => {
  const router = useRouter();
  const w = useWorkspace();
  const _expandedItems = typeof collapseLast !== "undefined" ? items.slice(0, items.length - collapseLast) : items;
  const _collapsedItems: MenuProps["items"] =
    typeof collapseLast !== "undefined"
      ? items.slice(items.length - collapseLast).map((item, i) => ({
          label: item.label,
          key: i,
          icon: item.icon,
          disabled: item.disabled,
          danger: item.danger,
          onClick: item.onClick || (item.href ? () => router.push(`/${w.slug || w.id}${item.href}`) : undefined),
        }))
      : [];
  const expandedItems = _expandedItems.filter(item => !item.collapsed);
  const collapsedItems = [..._expandedItems.filter(item => item.collapsed), ..._collapsedItems].map((item, i) => ({
    ...item,
    key: i,
  }));

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
          <JitsuButton
            className="text-lg font-bold p-0"
            icon={<JLucideIcon name={"more-vertical"} className={"w-4 h-4"} />}
          />
        </Dropdown>
      )}
    </AntButtonGroup>
  );
};
