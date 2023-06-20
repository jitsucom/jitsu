import React, { useEffect } from "react";
import { useKeyboard } from "../../lib/ui";

export type EditorBaseProps = {
  onCancel: (isTouched: boolean) => void;
  isTouched: boolean;
};

export const EditorBase: React.FC<React.PropsWithChildren<EditorBaseProps>> = ({ onCancel, isTouched, children }) => {
  useKeyboard("Escape", () => {
    onCancel(isTouched);
  });

  useEffect(() => {
    const handler = async event => {
      if (isTouched) {
        event.preventDefault();
        return (event.returnValue = "Are you sure you want to exit? You have unsaved changes");
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isTouched]);
  return (
    <div className="flex justify-center">
      <div className="max-w-4xl grow">{children}</div>
    </div>
  );
};
