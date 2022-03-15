import CopyOutlined from "@ant-design/icons/lib/icons/CopyOutlined"
import hljs from "highlight.js"
import "./hljs.css"
import { useState } from "react"
import { reactElementToString } from "../../commons/utils"

export type CodeProps = {
  language: string
  hideCopyButton?: boolean
  className?: string
}

function getLanguageSafe(lang: string) {
  return !lang || hljs.getLanguage(lang) === undefined ? "plaintext" : lang
}

function findIndent(str: string) {
  function isWhitespace(char: string) {
    return char === " " || char === "\t"
  }
  let ident = []

  for (let i = 0; i < str.length; i++) {
    let char = str[i]
    if (isWhitespace(char)) {
      ident.push(char)
    } else {
      break
    }
  }
  return ident.join("")
}

/**
 * Trims code. Finds a common indentation for each line (if any) and trims each line
 *
 * E.g.
 *
 * ```
 *    a
 *      b
 *    c
 * ```
 *
 * becomes
 *
 * ```
 * a
 *   b
 * c
 * ```
 *
 *
 * @param code
 */
function trimCode(code: string) {
  if (typeof code !== "string") {
    //throw new Error(`Invalid type of code: ${typeof code}: ${JSON.stringify(code, null, 2)}`)
    return code
  }
  let lines: string[] = code.split("\n")
  while (lines.length > 0 && lines[0].trim() === "") {
    lines = lines.slice(1)
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines = lines.slice(0, lines.length - 1)
  }
  if (lines.length > 0) {
    let indent = findIndent(lines[0])
    if (indent.length > 0) {
      lines = lines.map(line => (line.startsWith(indent) ? line.substr(indent.length) : line))
    }
  }
  return lines.join("\n").trim()
}

/**
 * Code component. Displays code snippet. Notes:
 *  - No background. Set your own background if needed
 *  - Rounded corners
 */
export const Code: React.FC<CodeProps> = ({ hideCopyButton, language, className, children }) => {
  const rawCode = trimCode(reactElementToString(children))
  const [copied, setCopied] = useState(false)
  const highlightedHtml = hljs.highlight(rawCode, { language: getLanguageSafe(language), ignoreIllegals: true }).value
  return (
    <div className={`font-monospace ${className} overflow-auto`}>
      <div className="relative">
        {!hideCopyButton && (
          <div
            onClick={() => {
              const el = document.createElement("textarea")

              el.value = rawCode
              document.body.appendChild(el)
              el.select()
              document.execCommand("copy")
              document.body.removeChild(el)
              setCopied(true)
              setTimeout(() => setCopied(false), 3000)
            }}
            className="absolute top-0 right-0 cursor-pointer hover:text-primary text-lg"
          >
            {!copied ? (
              <CopyOutlined />
            ) : (
              <span className="transition duration-500 ease-in-out text-xs border-b border-dotted">Copied!</span>
            )}
          </div>
        )}
        <pre className="overflow-visible" dangerouslySetInnerHTML={{ __html: highlightedHtml || rawCode }} />
      </div>
    </div>
  )
}
