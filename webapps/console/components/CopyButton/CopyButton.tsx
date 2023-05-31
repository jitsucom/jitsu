import { useState } from "react";
import { Button, Tooltip } from "antd";
import { copyTextToClipboard } from "../../lib/ui";

export function CopyButton({
  text,
  className,
  children,
}: {
  text: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [copyTitle, setCopyTitle] = useState("Copy");
  return (
    <Tooltip title={copyTitle}>
      <Button
        type="text"
        size="small"
        onClick={() => {
          copyTextToClipboard(text);
          setCopyTitle("Copied!");
          setInterval(() => setCopyTitle("Copy"), 2000);
        }}
      >
        {children}
      </Button>
    </Tooltip>
  );
}
