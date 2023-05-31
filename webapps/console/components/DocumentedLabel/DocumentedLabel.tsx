import { ReactNode } from "react";
import { Tooltip } from "antd";
import { FaInfoCircle } from "react-icons/fa";

export type DocumentedLabelProps = {
  name: ReactNode;
  doc?: ReactNode;
};

export const DocumentedLabel: React.FC<DocumentedLabelProps> = ({ name, doc }) => {
  if (!doc) {
    return <>{name}</>;
  }
  return (
    <div className="flex items-center">
      <div className={`pr-1`}>{name}</div>
      <Tooltip title={doc}>
        <FaInfoCircle />
      </Tooltip>
    </div>
  );
};
