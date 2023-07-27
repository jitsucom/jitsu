import React, { ReactNode } from "react";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import LucideIcon from "../Icons/LucideIcon";

export type EditorTitleProps<T extends { id: string } = { id: string }> = {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack: () => void;
};

export const EditorTitle: React.FC<EditorTitleProps> = ({ title, subtitle, onBack }) => {
  return (
    <>
      <div className="flex justify-between pt-6 pb-6 mb-0 items-center ">
        <h1 className="text-3xl">{title}</h1>
        <div>
          <JitsuButton
            icon={<LucideIcon name={"chevron-left"} className="w-6 h-6" />}
            type="link"
            size="small"
            onClick={onBack}
          >
            Back
          </JitsuButton>
        </div>
      </div>
      {subtitle && <div>{subtitle}</div>}
    </>
  );
};
