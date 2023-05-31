import { useEffect, useRef } from "react";
import { PropsWithChildrenClassname } from "../../lib/ui";
import { assertDefined } from "juava";

import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import htmlLang from "highlight.js/lib/languages/xml";
import typescript from "highlight.js/lib/languages/typescript";
import styles from "./CodeBlock.module.css";

export type SupportedLang = "html" | "javascript" | "json" | "yaml" | "typescript" | "tsx" | "jsx";
const langMap: Record<SupportedLang, any> = {
  html: htmlLang,
  javascript: javascript,
  json: json,
  jsx: javascript,
  tsx: typescript,
  typescript: typescript,
  yaml: yaml,
};

Object.entries(langMap).map(([lang, module]) => hljs.registerLanguage(lang, module));

import hljs from "highlight.js/lib/common";
import "highlight.js/styles/xcode.css";

export const CodeBlockLight: React.FC<PropsWithChildrenClassname<{ lang?: string }>> = ({
  lang,
  children,
  className,
}) => {
  assertDefined(children, "CodeBlock children must be defined");
  const codeRef = useRef(null);
  useEffect(() => {
    if (lang && codeRef.current) {
      hljs.highlightElement(codeRef.current);
    }
  }, [lang, children]);
  return (
    <div className={`relative group ${className}`}>
      <pre
        ref={codeRef}
        className={`${styles.codeBlockLight} whitespace-pre-wrap break-all rounded-lg language-${lang} `}
      >
        {children}
      </pre>
    </div>
  );
};
