import { ReactNode } from "react";

export type ButtonLabelProps = {
  icon?: ReactNode;
  children?: ReactNode;
  loading?: boolean;
  iconPosition?: "left" | "right";
  className?: string;
  iconSize?: "default" | "small";
};

const BouncingDotsLoader = () => {
  return (
    <div className="flex justify-center items-center gap-2">
      <div key={1} className="animate-bounce h-1.5 w-1.5 bg-current rounded-full "></div>
      <div
        key={2}
        className="animate-bounce h-1.5 w-1.5 bg-current rounded-full "
        style={{ animationDelay: "150ms" }}
      ></div>
      <div
        key={4}
        className="animate-bounce h-1.5 w-1.5 bg-current rounded-full "
        style={{ animationDelay: "300ms" }}
      ></div>
    </div>
  );
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
      <div className={`flex items-center ${loading ? "invisible" : ""}`}>
        {icon && iconPosition === "left" && !loading && <span className={iconClass}>{icon}</span>}
        {children && (
          <span
            className={
              icon
                ? iconPosition === "left"
                  ? iconSize === "small"
                    ? "ml-2"
                    : "ml-1"
                  : iconSize === "small"
                  ? "mr-2"
                  : "mr-1"
                : ""
            }
          >
            {children}
          </span>
        )}
        {icon && iconPosition === "right" && !loading && <span className={iconClass}>{icon}</span>}
      </div>
      {loading && !icon && (
        <div className="w-full h-full absolute flex justify-center items-center top-0 left-0">
          <BouncingDotsLoader />
        </div>
      )}
    </div>
  );
};
