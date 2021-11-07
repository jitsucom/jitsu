import React from "react"
import { CenteredSpin } from "lib/components/components"
import { Props } from "./CodeEditor.types"

// import CodeEditorComponent from "ui/components/CodeEditor/CodeEditorComponent"
const CodeEditorComponent = React.lazy(() => import("ui/components/CodeEditor/CodeEditorComponent"))

export const CodeEditor = (props: Props) => (
  // null
  <React.Suspense fallback={<CenteredSpin />}>
    <CodeEditorComponent {...props} />
  </React.Suspense>
)
