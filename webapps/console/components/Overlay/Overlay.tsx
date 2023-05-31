import { PropsWithChildren } from "react";
import styles from "./Overlay.module.css";
import { Button } from "antd";
import { useKeyboard } from "../../lib/ui";
import { CloseCircleFilled } from "@ant-design/icons";

export type OverlayProps = PropsWithChildren<{ className?: string; onClose?: () => void; closable?: boolean }>;
export const Overlay: React.FC<OverlayProps> = ({ onClose = () => {}, children, className = "", closable = true }) => {
  useKeyboard("Escape", onClose);
  return (
    <div
      className={styles.overlay}
      onClick={e => {
        if (closable) {
          onClose();
          e.stopPropagation();
        }
      }}
    >
      <div className={styles.overlayInternal} onClick={e => e.stopPropagation()}>
        <div className="absolute top-0 right-0 mt-2 mr-2 z-10">
          {closable && (
            <Button type="link" size="large" onClick={onClose}>
              <CloseCircleFilled />
            </Button>
          )}
        </div>
        <div className={styles.overlayContent + " " + className}>{children}</div>
      </div>
    </div>
  );
};
