import { ReactNode } from "react";

export type ButtonLabelProps = {
  icon: ReactNode;
  children?: ReactNode;
  loading?: boolean;
  iconPosition?: "left" | "right";
  className?: string;
};

export const ButtonLabel: React.FC<ButtonLabelProps> = ({
  children,
  icon,
  loading,
  iconPosition = "left",
  className,
}) => {
  return (
    <div className={`relative inline-flex justify-center items-center ${className || ""} ${children ? "" : "h-full"}`}>
      <div className={`flex items-center`}>
        {iconPosition === "left" && !loading && <span className="">{icon}</span>}
        {children && <span className={iconPosition === "left" ? "ml-1" : "mr-1"}>{children}</span>}
        {iconPosition === "right" && !loading && <span>{icon}</span>}
      </div>
    </div>
  );
};
