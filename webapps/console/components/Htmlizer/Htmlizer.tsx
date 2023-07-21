import React, { PropsWithChildren } from "react";

export const Htmlizer: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  return typeof children === "string" ? <span dangerouslySetInnerHTML={{ __html: children }} /> : <>{children}</>;
};
