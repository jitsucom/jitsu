import { Light as SyntaxHighlighter } from "react-syntax-highlighter"
import dark from "react-syntax-highlighter/dist/esm/styles/hljs/dark"
import js from "react-syntax-highlighter/dist/esm/languages/hljs/javascript"
import json from "react-syntax-highlighter/dist/esm/languages/hljs/json"
import yaml from "react-syntax-highlighter/dist/esm/languages/hljs/yaml"
import bash from "react-syntax-highlighter/dist/esm/languages/hljs/bash"
import html from "react-syntax-highlighter/dist/esm/languages/hljs/xml"
import set from "lodash/set"

SyntaxHighlighter.registerLanguage("javascript", js)
SyntaxHighlighter.registerLanguage("json", json)
SyntaxHighlighter.registerLanguage("yaml", yaml)
SyntaxHighlighter.registerLanguage("bash", bash)
SyntaxHighlighter.registerLanguage("html", html)

set(dark, "hljs.background", "#1e2a31")

type Props = {
  language: string
  className?: string
}

export const SyntaxHighlighterAsync: React.FC<Props> = ({ children, language, className }) => (
  <SyntaxHighlighter style={dark} className={className} language={language}>
    {children}
  </SyntaxHighlighter>
)

//lazyComponent(() => import( /* webpackPrefetch: true */ 'react-syntax-highlighter'));
