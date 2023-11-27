function formatCode(code: string) {
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
  return lines.join("\n")
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

export function getEmbeddedHtml(segment: boolean, key: string, host: string) {
  return formatCode(`
    <script src="${host}/s/lib.js"
            data-key="${key}"${segment ? '\n            data-segment-hook="true"' : ""}
            data-init-only="${segment ? "true" : "false"}"${!segment ? "\n            defer" : ""}></script>
    <script>window.jitsu = window.jitsu || (function(){(window.jitsuQ = window.jitsuQ || []).push(arguments);})</script>
    `)
}

export function getNPMDocumentation(key: string, host: string) {
  return formatCode(`
    import { jitsuClient } from '@jitsu/sdk-js'
    //init
    const jitsu = jitsuClient({
        key: "${key}",
        tracking_host: "${host}"
    });
    //identify user
    jitsu.id({
        "email": getEmail(),
        "internal_id": getId()
    });
    //track page views
    jitsu.track('app_page');
    `)
}

export function getCurlDocumentation(key: string, host: string) {
  return formatCode(`
    curl -i -X POST -H "Content-Type: application/json" \\
      -H 'X-Auth-Token: ${key}' \\
      --data-binary '{"test_str_field": "str", "test_int_field": 42}' '${host}/api/v1/s2s/event'
    `)
}
