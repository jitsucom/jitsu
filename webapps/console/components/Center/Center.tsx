import { PropsWithChildren } from "react";

export const Center: React.FC<PropsWithChildren<{ vertical?: boolean; horizontal?: boolean }>> = ({
  vertical,
  horizontal,
  children,
}) => {
  return (
    <div className={`flex flex-col ${vertical ? "justify-center" : ""} ${horizontal ? "items-center" : ""}`}>
      {children}
    </div>
  );
};
