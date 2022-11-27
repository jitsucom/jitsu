// @Libs

// @Components
import { SourceEditorFormStreamsConfigurable } from "./SourceEditorFormStreamsConfigurable"
import { SourceEditorFormStreamsLoadable } from "./SourceEditorFormStreamsLoadable"
// @Types
import { SourceConnector } from "@jitsu/catalog"
import { SetSourceEditorState } from "./SourceEditor"

type Props = {
  editorMode: "add" | "edit"
  disabled?: boolean
  initialSourceData: Optional<Partial<SourceData>>
  sourceDataFromCatalog: SourceConnector
  setSourceEditorState: SetSourceEditorState
  handleBringSourceData: () => SourceData
}

export const SourceEditorFormStreams: React.FC<Props> = ({
  editorMode,
  disabled,
  initialSourceData,
  sourceDataFromCatalog,
  setSourceEditorState,
  handleBringSourceData,
}) => {
  const typedStreams: boolean =
    !sourceDataFromCatalog.protoType ||
    sourceDataFromCatalog.protoType == "sdk_source" ||
    sourceDataFromCatalog.protoType == "native"
  return typedStreams ? (
    <SourceEditorFormStreamsConfigurable
      disabled={!!disabled}
      initialSourceData={initialSourceData as NativeSourceData | SDKSourceData}
      sourceDataFromCatalog={sourceDataFromCatalog}
      setSourceEditorState={setSourceEditorState}
      handleBringSourceData={handleBringSourceData}
    />
  ) : (
    <SourceEditorFormStreamsLoadable
      disabled={!!disabled}
      editorMode={editorMode}
      initialSourceData={initialSourceData as AirbyteSourceData | SingerSourceData}
      sourceDataFromCatalog={sourceDataFromCatalog}
      setSourceEditorState={setSourceEditorState}
      handleBringSourceData={handleBringSourceData}
    />
  )
}
