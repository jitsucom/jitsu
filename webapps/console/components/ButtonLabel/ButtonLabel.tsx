import { ReactNode } from "react";

export type ButtonLabelProps = {
  icon: ReactNode;
  children?: ReactNode;
  loading?: boolean;
  iconPosition?: "left" | "right";
  className?: string;
  iconSize?: "default" | "small";
};

export const ButtonLabel: React.FC<ButtonLabelProps> = ({
  children,
  icon,
  loading,
  iconPosition = "left",
  className,
  iconSize = "default",
}) => {
  const iconClass = iconSize === "small" ? "scale-75" : "";
  return (
    <div className={`relative inline-flex justify-center items-center ${className || ""} ${children ? "" : "h-full"}`}>
      <div className={`flex items-center`}>
        {iconPosition === "left" && !loading && <span className={iconClass}>{icon}</span>}
        {children && (
          <span
            className={
              iconPosition === "left"
                ? iconSize === "small"
                  ? "ml-2"
                  : "ml-1"
                : iconSize === "small"
                ? "mr-2"
                : "mr-1"
            }
          >
            {children}
          </span>
        )}
        {iconPosition === "right" && !loading && <span className={iconClass}>{icon}</span>}
      </div>
    </div>
  );
};
