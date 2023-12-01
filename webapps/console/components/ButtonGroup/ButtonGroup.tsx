import { Button, Dropdown, MenuProps, Tooltip } from "antd";
import React from "react";
import { JitsuButton, WJitsuButton } from "../JitsuButton/JitsuButton";
import { BaseButtonProps } from "antd/lib/button/button";
import styles from "./ButtonGroup.module.css";
import { useRouter } from "next/router";
import { useWorkspace } from "../../lib/context";
import { MoreVertical } from "lucide-react";
import Link from "next/link";

const AntButtonGroup = Button.Group;

export type ButtonProps = Omit<BaseButtonProps, "children" | "type"> & {
  href?: string;
  label?: React.ReactNode;
  collapsed?: boolean;
  // if label is not a string, tooltip text will be used for Tooltip
  tooltip?: string;
  onClick?: () => void;
};

export type ButtonGroupProps = {
  items: ButtonProps[];
  dotsButtonProps?: BaseButtonProps;
};

export const ButtonGroup: React.FC<ButtonGroupProps> = ({ items, dotsButtonProps }) => {
  const router = useRouter();
  const w = useWorkspace();
  const expandedItems = items.filter(item => !item.collapsed);
  const collapsedItems: MenuProps["items"] = items
    .filter(item => item.collapsed)
    .map((item, i) => ({
      label: item.href ? (
        <Link prefetch={true} href={`/${w.slug || w.id}/${item.href}`}>
          {item.label}
        </Link>
      ) : (
        item.label
      ),
      key: i,
      icon: item.icon,
      disabled: item.disabled,
      danger: item.danger,
      onClick: item.onClick || (item.href ? () => router.push(`/${w.slug || w.id}${item.href}`) : undefined),
    }));

  return (
    <AntButtonGroup className={styles.buttonGroup}>
      {expandedItems.map((item, i) => {
        if (item.href) {
          return (
            <Tooltip title={typeof item.label === "string" ? item.label : item.tooltip} key={i}>
              <WJitsuButton {...item} key={i} href={item.href} />
            </Tooltip>
          );
        }
        return (
          <Tooltip title={typeof item.label === "string" ? item.label : item.tooltip} key={i}>
            <JitsuButton {...item} key={i} />
          </Tooltip>
        );
      })}
      {collapsedItems.length > 0 && (
        <Dropdown trigger={["click"]} menu={{ items: collapsedItems }}>
          <JitsuButton
            className="text-lg font-bold p-0"
            icon={<MoreVertical className={"w-4 h-4"} />}
            {...dotsButtonProps}
          />
        </Dropdown>
      )}
    </AntButtonGroup>
  );
};
