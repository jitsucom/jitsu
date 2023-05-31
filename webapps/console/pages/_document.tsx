import { Head, Html, Main, NextScript } from "next/document";
import { getLog } from "juava";

export default function Document() {
  return (
    <Html>
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

const log = getLog("app");
