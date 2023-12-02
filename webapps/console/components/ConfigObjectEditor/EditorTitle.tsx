import React, { ReactNode } from "react";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import { ChevronLeft } from "lucide-react";

export type EditorTitleProps<T extends { id: string } = { id: string }> = {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack: () => void;
};

export const EditorTitle: React.FC<EditorTitleProps> = ({ title, subtitle, onBack }) => {
  return (
    <>
      <div className="flex justify-between pt-6 pb-4 mb-0 items-center ">
        <h1 className="text-3xl">{title}</h1>
        <div>
          <JitsuButton icon={<ChevronLeft className="w-6 h-6" />} type="link" size="small" onClick={onBack}>
            Back
          </JitsuButton>
        </div>
      </div>
      {subtitle && <div>{subtitle}</div>}
    </>
  );
};
