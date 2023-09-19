import { useEffect, useRef } from "react";
import { PropsWithChildrenClassname } from "../../lib/ui";
import { assertDefined } from "juava";

import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import htmlLang from "highlight.js/lib/languages/xml";
import typescript from "highlight.js/lib/languages/typescript";
import bash from "highlight.js/lib/languages/bash";
import plaintext from "highlight.js/lib/languages/plaintext";

import styles from "./CodeBlock.module.css";

export type SupportedLang =
  | "html"
  | "javascript"
  | "json"
  | "yaml"
  | "typescript"
  | "tsx"
  | "jsx"
  | "bash"
  | "plaintext";
const langMap: Record<SupportedLang, any> = {
  html: htmlLang,
  javascript: javascript,
  json: json,
  jsx: javascript,
  tsx: typescript,
  typescript: typescript,
  yaml: yaml,
  bash: bash,
  plaintext: plaintext,
};

Object.entries(langMap).map(([lang, module]) => hljs.registerLanguage(lang, module));

import "highlight.js/styles/github-dark.css";

import hljs from "highlight.js/lib/common";
import { CopyButton } from "../CopyButton/CopyButton";
import { Copy } from "lucide-react";

export const CodeBlock: React.FC<PropsWithChildrenClassname<{ lang?: string; breaks?: "words" | "all" }>> = ({
  lang,
  breaks,
  children,
  className,
}) => {
  assertDefined(children, "CodeBlock children must be defined");
  const codeRef = useRef(null);
  useEffect(() => {
    if (lang && codeRef.current) {
      hljs.highlightBlock(codeRef.current);
    }
  }, [lang, children]);
  return (
    <div className={`relative group ${styles.blockWrapper} ${className}`}>
      <div className="absolute top-0 right-0 hidden group-hover:block a mr-1 mt-1">
        <CopyButton text={children.toString()} className="text-primary">
          <Copy className="mt-2 w-5 h-5 text-textInverted" />
        </CopyButton>
      </div>
      <pre
        ref={codeRef}
        className={`bg-textDark ${
          breaks === "all"
            ? "break-all whitespace-pre-wrap"
            : breaks === "words"
            ? "whitespace-pre-wrap break-words"
            : ""
        } px-4 pr-9 py-3 overflow-auto rounded-lg text-bgLight language-${lang}`}
      >
        {children}
      </pre>
    </div>
  );
};
