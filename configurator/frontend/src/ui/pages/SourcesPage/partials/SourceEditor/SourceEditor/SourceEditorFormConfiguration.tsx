// @Libs
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useState } from "react"
// @Types
import { SourceConnector as CatalogSourceConnector } from "catalog/sources/types"
import { SetSourceEditorState } from "./SourceEditor"
// @Components
import { SourceEditorFormConfigurationStaticFields } from "./SourceEditorFormConfigurationStaticFields"
import { SourceEditorFormConfigurationConfigurableLoadableFields } from "./SourceEditorFormConfigurationConfigurableLoadableFields"
import { cloneDeep } from "lodash"

type Props = {
  editorMode: "add" | "edit"
  initialSourceDataFromBackend: Optional<Partial<SourceData>>
  sourceDataFromCatalog: CatalogSourceConnector
  setSourceEditorState: SetSourceEditorState
  setControlsDisabled: ReactSetState<boolean>
  setTabErrorsVisible: (value: boolean) => void
  setConfigIsValidatedByStreams: (value: boolean) => void
}

export type ValidateGetErrorsCount = () => Promise<number>
export type PatchConfig = (
  key: string,
  allValues: PlainObjectWithPrimitiveValues,
  options?: {
    doNotSetStateChanged?: boolean
  }
) => void

const initialValidator: () => ValidateGetErrorsCount = () => async () => 0

const SourceEditorFormConfiguration: React.FC<Props> = ({
  editorMode,
  initialSourceDataFromBackend,
  sourceDataFromCatalog,
  setSourceEditorState,
  setControlsDisabled,
  setTabErrorsVisible,
  setConfigIsValidatedByStreams,
}) => {
  const [staticFieldsValidator, setStaticFieldsValidator] = useState<ValidateGetErrorsCount>(initialValidator)
  const [configurableLoadableFieldsValidator, setConfigurableLoadableFieldsValidator] =
    useState<ValidateGetErrorsCount>(initialValidator)

  const patchConfig = useCallback<PatchConfig>((key, allValues, options) => {
    setSourceEditorState(state => {
      const newState = cloneDeep(state)

      newState.configuration.config[key] = allValues

      if (!options?.doNotSetStateChanged) newState.stateChanged = true

      setTabErrorsVisible(false)
      setConfigIsValidatedByStreams(false)

      return newState
    })
  }, [])

  useEffect(() => {
    const validateConfigAndCountErrors = async (): Promise<number> => {
      const staticFieldsErrorsCount = await staticFieldsValidator()
      const configurableLoadableFieldsErrorsCount = await configurableLoadableFieldsValidator()
      return staticFieldsErrorsCount + configurableLoadableFieldsErrorsCount
    }

    setSourceEditorState(state => {
      const newState = cloneDeep(state)
      newState.configuration.getErrorsCount = validateConfigAndCountErrors
      return newState
    })
  }, [staticFieldsValidator, configurableLoadableFieldsValidator])

  /**
   * Sets source type specific fields
   */
  useEffect(() => {
    patchConfig(
      "dockerImageField",
      { "config.docker_image": sourceDataFromCatalog.id.replace("airbyte-", "") },
      { doNotSetStateChanged: true }
    )
  }, [])

  return (
    <>
      <SourceEditorFormConfigurationStaticFields
        editorMode={editorMode}
        initialValues={initialSourceDataFromBackend}
        patchConfig={patchConfig}
        setValidator={setStaticFieldsValidator}
      />
      <SourceEditorFormConfigurationConfigurableLoadableFields
        initialValues={initialSourceDataFromBackend}
        sourceDataFromCatalog={sourceDataFromCatalog}
        patchConfig={patchConfig}
        setControlsDisabled={setControlsDisabled}
        setValidator={setConfigurableLoadableFieldsValidator}
      />
    </>
  )
}

const Wrapped = observer(SourceEditorFormConfiguration)

Wrapped.displayName = "SourceEditorFormConfiguration"

export { Wrapped as SourceEditorFormConfiguration }