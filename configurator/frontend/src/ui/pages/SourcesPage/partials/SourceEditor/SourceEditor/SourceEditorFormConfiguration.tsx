// @Libs
import { observer } from "mobx-react-lite"
import { useCallback, useEffect, useMemo, useState } from "react"
import { cloneDeep } from "lodash"
// @Types
import { SourceConnector as CatalogSourceConnector } from "catalog/sources/types"
import { SetSourceEditorState } from "./SourceEditor"
// @Components
import { SourceEditorFormConfigurationStaticFields } from "./SourceEditorFormConfigurationStaticFields"
import { SourceEditorFormConfigurationConfigurableLoadableFields } from "./SourceEditorFormConfigurationConfigurableLoadableFields"
import { SourceEditorFormConfigurationConfigurableFields } from "./SourceEditorFormConfigurationConfigurableFields"
import { OauthButton } from "../../OauthButton/OauthButton"

type Props = {
  editorMode: "add" | "edit"
  initialSourceData: Optional<Partial<SourceData>>
  sourceDataFromCatalog: CatalogSourceConnector
  forceFieldsValues: PlainObjectWithPrimitiveValues
  disabled?: boolean
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

type Forms = {
  staticFields: PlainObjectWithPrimitiveValues | null
  configurableFields: PlainObjectWithPrimitiveValues | null
  configurableLoadableFields: PlainObjectWithPrimitiveValues | null
}

const initialValidator: () => ValidateGetErrorsCount = () => async () => 0

const SourceEditorFormConfiguration: React.FC<Props> = ({
  editorMode,
  initialSourceData,
  sourceDataFromCatalog,
  forceFieldsValues,
  disabled,
  setSourceEditorState,
  setControlsDisabled,
  setTabErrorsVisible,
  setConfigIsValidatedByStreams,
}) => {
  const [forms, setForms] = useState<Forms>({
    staticFields: null,
    configurableFields: null,
    configurableLoadableFields: null,
  })

  const [staticFieldsValidator, setStaticFieldsValidator] = useState<ValidateGetErrorsCount>(initialValidator)
  const [configurableFieldsValidator, setConfigurableFieldsValidator] =
    useState<ValidateGetErrorsCount>(initialValidator)
  const [configurableLoadableFieldsValidator, setConfigurableLoadableFieldsValidator] =
    useState<ValidateGetErrorsCount>(initialValidator)

  const sourceConfigurationSchema = useMemo(() => {
    switch (sourceDataFromCatalog.protoType) {
      case "airbyte":
        return {
          loadableFieldsEndpoint: "test",
          invisibleStaticFields: {
            "config.docker_image": sourceDataFromCatalog.id.replace("airbyte-", ""),
          },
        }
      case "singer":
        return {
          configurableFields: sourceDataFromCatalog.configParameters,
          invisibleStaticFields: {
            "config.tap": sourceDataFromCatalog.id.replace("singer-", ""),
          },
        }
    }
  }, [])

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
      const configurableFieldsErrorsCount = await configurableFieldsValidator()
      const configurableLoadableFieldsErrorsCount = await configurableLoadableFieldsValidator()
      return staticFieldsErrorsCount + configurableLoadableFieldsErrorsCount + configurableFieldsErrorsCount
    }

    setSourceEditorState(state => {
      const newState = cloneDeep(state)
      newState.configuration.getErrorsCount = validateConfigAndCountErrors
      return newState
    })
  }, [staticFieldsValidator, configurableFieldsValidator, configurableLoadableFieldsValidator])

  /**
   * Sets source type specific fields that are not configurable by user
   */
  useEffect(() => {
    sourceConfigurationSchema.invisibleStaticFields &&
      patchConfig("invisibleStaticFields", sourceConfigurationSchema.invisibleStaticFields, {
        doNotSetStateChanged: true,
      })
  }, [])

  return (
    <div>
      <fieldset key="fields" disabled={disabled}>
        <SourceEditorFormConfigurationStaticFields
          editorMode={editorMode}
          initialValues={initialSourceData}
          patchConfig={patchConfig}
          setValidator={setStaticFieldsValidator}
        />
        {sourceConfigurationSchema.configurableFields && (
          <SourceEditorFormConfigurationConfigurableFields
            initialValues={initialSourceData}
            configParameters={sourceConfigurationSchema.configurableFields}
            forceFieldsValues={forceFieldsValues}
            patchConfig={patchConfig}
            setValidator={setConfigurableFieldsValidator}
          />
        )}
        {sourceConfigurationSchema.loadableFieldsEndpoint && (
          <SourceEditorFormConfigurationConfigurableLoadableFields
            initialValues={initialSourceData}
            forceFieldsValues={forceFieldsValues}
            sourceDataFromCatalog={sourceDataFromCatalog}
            patchConfig={patchConfig}
            setControlsDisabled={setControlsDisabled}
            setValidator={setConfigurableLoadableFieldsValidator}
          />
        )}
      </fieldset>
    </div>
  )
}

const Wrapped = observer(SourceEditorFormConfiguration)

Wrapped.displayName = "SourceEditorFormConfiguration"

export { Wrapped as SourceEditorFormConfiguration }
