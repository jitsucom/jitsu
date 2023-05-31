import { ReactNode, useState } from "react";
import { FaCaretDown, FaCaretRight } from "react-icons/fa";
import { PropsWithChildrenClassname } from "../../lib/ui";

export type Title = ReactNode | ((expanded: boolean) => ReactNode);

type ExpandableProps = {
  title: Title;
  titleClassName?: string;
  initiallyExpanded?: boolean;
  caretSize?: string;
  contentLeftPadding?: boolean;
  hideArrow?: boolean;
};
export const Expandable: React.FC<PropsWithChildrenClassname<ExpandableProps>> = ({
  initiallyExpanded,
  titleClassName,
  children,
  title,
  className,
  contentLeftPadding = false,
  caretSize = "1em",
  hideArrow = false,
}) => {
  const [expanded, setExpanded] = useState(!!initiallyExpanded);
  return (
    <div className={`w-full`}>
      <div
        className={`flex items-center cursor-pointer ${titleClassName} transition-all`}
        onClick={() => setExpanded(!expanded)}
      >
        {hideArrow ? (
          <></>
        ) : expanded ? (
          <FaCaretDown style={{ height: caretSize, width: caretSize }} />
        ) : (
          <FaCaretRight style={{ height: caretSize, width: caretSize }} />
        )}
        <div className="ml-2">{typeof title === "function" ? title(expanded) : title}</div>
      </div>
      {
        <div
          className={`mb-1 ${contentLeftPadding ? "ml-6" : ""} ${className} ${
            expanded ? "block" : "hidden h-0"
          } transition-all`}
        >
          {children}
        </div>
      }
    </div>
  );
};
