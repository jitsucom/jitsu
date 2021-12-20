// @Libs

// @Components
import { SourceEditorFormStreamsConfigurable } from "./SourceEditorFormStreamsConfigurable"
import { SourceEditorFormStreamsLoadable } from "./SourceEditorFormStreamsLoadable"
// @Types
import { SourceConnector } from "catalog/sources/types"
import { SetSourceEditorState } from "./SourceEditor"

type Props = {
  initialSourceData: Optional<Partial<SourceData>>
  sourceDataFromCatalog: SourceConnector
  sourceConfigValidatedByStreamsTab: boolean
  setSourceEditorState: SetSourceEditorState
  handleSetControlsDisabled: (disabled: boolean | string, setterId: string) => void
  setConfigIsValidatedByStreams: (value: boolean) => void
  handleBringSourceData: () => SourceData
}

export const SourceEditorFormStreams: React.FC<Props> = ({
  initialSourceData,
  sourceDataFromCatalog,
  sourceConfigValidatedByStreamsTab,
  setSourceEditorState,
  handleSetControlsDisabled,
  setConfigIsValidatedByStreams,
  handleBringSourceData,
}) => {
  const isNativeSource: boolean = !sourceDataFromCatalog.protoType
  return isNativeSource ? (
    <SourceEditorFormStreamsConfigurable
      initialSourceData={initialSourceData}
      sourceDataFromCatalog={sourceDataFromCatalog}
      setSourceEditorState={setSourceEditorState}
    />
  ) : (
    <SourceEditorFormStreamsLoadable
      initialSourceData={initialSourceData}
      sourceDataFromCatalog={sourceDataFromCatalog}
      sourceConfigValidatedByStreamsTab={sourceConfigValidatedByStreamsTab}
      setSourceEditorState={setSourceEditorState}
      handleSetControlsDisabled={handleSetControlsDisabled}
      setConfigIsValidatedByStreams={setConfigIsValidatedByStreams}
      handleBringSourceData={handleBringSourceData}
    />
  )
}
