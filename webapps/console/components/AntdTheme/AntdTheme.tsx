import { PropsWithChildren } from "react";
import { ConfigProvider } from "antd";
import { StyleProvider } from "@ant-design/cssinjs";

const theme = require("../../theme.config.js");

export const AntdTheme: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  const antdColors = {
    colorPrimary: theme.primary,
  };
  return (
    <ConfigProvider theme={{ token: antdColors }}>
      <StyleProvider hashPriority="high">{children}</StyleProvider>
    </ConfigProvider>
  );
};
