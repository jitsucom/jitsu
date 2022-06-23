// @Libs

// @Components
import { SourceEditorFormStreamsConfigurable } from "./SourceEditorFormStreamsConfigurable"
import { SourceEditorFormStreamsLoadable } from "./SourceEditorFormStreamsLoadable"
// @Types
import { SourceConnector } from "@jitsu/catalog"
import { SetSourceEditorState } from "./SourceEditor"

type Props = {
  editorMode: "add" | "edit"
  initialSourceData: Optional<Partial<SourceData>>
  sourceDataFromCatalog: SourceConnector
  setSourceEditorState: SetSourceEditorState
  handleBringSourceData: () => SourceData
}

export const SourceEditorFormStreams: React.FC<Props> = ({
  editorMode,
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
      initialSourceData={initialSourceData as NativeSourceData | SDKSourceData}
      sourceDataFromCatalog={sourceDataFromCatalog}
      setSourceEditorState={setSourceEditorState}
      handleBringSourceData={handleBringSourceData}
    />
  ) : (
    <SourceEditorFormStreamsLoadable
      editorMode={editorMode}
      initialSourceData={initialSourceData as AirbyteSourceData | SingerSourceData}
      sourceDataFromCatalog={sourceDataFromCatalog}
      setSourceEditorState={setSourceEditorState}
      handleBringSourceData={handleBringSourceData}
    />
  )
}
