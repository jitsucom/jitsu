import React, { ReactNode } from "react";
import classNames from "classnames";
import Link from "next/link";

export type EditorToolbarProps = {
  items: {
    title: ReactNode;
    icon: ReactNode;
    href: string;
    onClick?: () => void;
  }[];
  className?: string;
};

export const EditorToolbar: React.FC<EditorToolbarProps> = ({ items, className }) => {
  return (
    <div className={classNames(className, `flex flex-nowrap items-center gap-2`)}>
      {items.map(({ href, icon, title, onClick }, index) => (
        <Link
          key={index}
          href={href}
          className="flex items-center space-x-2 border border-textLight px-2 py-1 rounded text-textLight text-xs"
          onClick={onClick}
        >
          <div className="h-4 w-4">{icon}</div>
          <span>{title}</span>
        </Link>
      ))}
    </div>
  );
};
