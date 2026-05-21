import type { AppProps } from "next/app";
import Head from "next/head";
import { App as AntdApp, ConfigProvider } from "antd";
import { StyleProvider } from "@ant-design/cssinjs";
import { AuthProvider } from "../components/AuthProvider";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Jitsu Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </Head>
      <StyleProvider hashPriority="high">
        <ConfigProvider theme={{ token: { colorPrimary: "#4f46e5" } }}>
          <AntdApp>
            <AuthProvider>
              <Component {...pageProps} />
            </AuthProvider>
          </AntdApp>
        </ConfigProvider>
      </StyleProvider>
    </>
  );
}
