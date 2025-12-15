import { PropsWithChildren } from "react";
import { ConfigProvider } from "antd";
import { StyleProvider } from "@ant-design/cssinjs";

const theme = require("../../theme.config.js");

export const AntdTheme: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  const antdColors = {
    colorPrimary: theme.primary,
  };
  return (
    <ConfigProvider
      tag={{
        variant: "outlined",
      }}
      wave={{
        disabled: true,
      }}
      theme={{
        token: antdColors,
        components: {
          Splitter: {
            splitBarDraggableSize: 40,
          },
        },
      }}
    >
      <StyleProvider hashPriority="high">{children}</StyleProvider>
    </ConfigProvider>
  );
};
