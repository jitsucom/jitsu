// @Libs

// @Components
import { SourceEditorFormStreamsConfigurable } from "./SourceEditorFormStreamsConfigurable"
import { SourceEditorFormStreamsLoadable } from "./SourceEditorFormStreamsLoadable"
// @Types
import { SourceConnector } from "@jitsu/catalog/sources/types"
import { SetSourceEditorState } from "./SourceEditor"

type Props = {
  editorMode: "add" | "edit"
  initialSourceData: Optional<Partial<SourceData>>
  sourceDataFromCatalog: SourceConnector
  setSourceEditorState: SetSourceEditorState
  handleSetControlsDisabled: (disabled: boolean | string, setterId: string) => void
  handleBringSourceData: () => SourceData
}

export const SourceEditorFormStreams: React.FC<Props> = ({
  editorMode,
  initialSourceData,
  sourceDataFromCatalog,
  setSourceEditorState,
  handleSetControlsDisabled,
  handleBringSourceData,
}) => {
  const isNativeSource: boolean = !sourceDataFromCatalog.protoType
  return isNativeSource ? (
    <SourceEditorFormStreamsConfigurable
      initialSourceData={initialSourceData as NativeSourceData}
      sourceDataFromCatalog={sourceDataFromCatalog}
      setSourceEditorState={setSourceEditorState}
    />
  ) : (
    <SourceEditorFormStreamsLoadable
      editorMode={editorMode}
      initialSourceData={initialSourceData as AirbyteSourceData | SingerSourceData}
      sourceDataFromCatalog={sourceDataFromCatalog}
      setSourceEditorState={setSourceEditorState}
      handleSetControlsDisabled={handleSetControlsDisabled}
      handleBringSourceData={handleBringSourceData}
    />
  )
}
