import React, { PropsWithChildren, ReactNode } from "react";
import styles from "./ExpandableButton.module.css";

export const ExpandableButton: React.FC<
  PropsWithChildren<{ icon: ReactNode; onClick: () => void | Promise<void> }>
> = props => {
  return (
    <button onClick={props.onClick} className={styles.expandableButton}>
      <span className={styles.icon}>{props.icon}</span>
      <span className={styles.title}>{props.children}</span>
    </button>
  );
};
