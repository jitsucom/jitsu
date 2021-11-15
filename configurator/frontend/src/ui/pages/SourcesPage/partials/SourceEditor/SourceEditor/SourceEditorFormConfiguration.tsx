// @Libs
import { observer } from "mobx-react-lite"
import { useCallback, useEffect, useMemo, useState } from "react"
import { cloneDeep } from "lodash"
import { Col, FormInstance, Row } from "antd"
// @Types
import { SourceConnector as CatalogSourceConnector } from "catalog/sources/types"
import { SetSourceEditorState } from "./SourceEditor"
// @Components
import { SourceEditorFormConfigurationStaticFields } from "./SourceEditorFormConfigurationStaticFields"
import { SourceEditorFormConfigurationConfigurableLoadableFields } from "./SourceEditorFormConfigurationConfigurableLoadableFields"
import { SourceEditorFormConfigurationConfigurableFields } from "./SourceEditorFormConfigurationConfigurableFields"
import { actionNotification } from "ui/components/ActionNotification/ActionNotification"
import { OauthButton } from "../../OauthButton/OauthButton"
import { handleError } from "lib/components/components"
// @Utils
import { toTitleCase } from "utils/strings"

type Props = {
  editorMode: "add" | "edit"
  initialSourceData: Optional<Partial<SourceData>>
  sourceDataFromCatalog: CatalogSourceConnector
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

export type SetFormReference = (key: string, form: FormInstance) => void

type Forms = {
  [key: string]: FormInstance<PlainObjectWithPrimitiveValues>
}

const initialValidator: () => ValidateGetErrorsCount = () => async () => 0

const SourceEditorFormConfiguration: React.FC<Props> = ({
  editorMode,
  initialSourceData,
  sourceDataFromCatalog,
  disabled,
  setSourceEditorState,
  setControlsDisabled,
  setTabErrorsVisible,
  setConfigIsValidatedByStreams,
}) => {
  const [forms, setForms] = useState<Forms>({})

  const [staticFieldsValidator, setStaticFieldsValidator] = useState<ValidateGetErrorsCount>(initialValidator)
  const [configurableFieldsValidator, setConfigurableFieldsValidator] =
    useState<ValidateGetErrorsCount>(initialValidator)
  const [configurableLoadableFieldsValidator, setConfigurableLoadableFieldsValidator] =
    useState<ValidateGetErrorsCount>(initialValidator)

  const setFormReference = useCallback<SetFormReference>((key, form) => {
    setForms(forms => ({ ...forms, [key]: form }))
  }, [])

  const setOauthSecretsToForms = useCallback<(secrets: PlainObjectWithPrimitiveValues) => void>(
    secrets => {
      applyOauthValuesToForms(forms, secrets)
    },
    [forms]
  )

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
      <Row key="oauth-button" className="h-8 mb-5">
        <Col span={4} />
        <Col span={20} className="pl-2">
          <OauthButton
            key="oauth-button"
            service={sourceDataFromCatalog.id}
            forceNotSupported={sourceDataFromCatalog.expertMode}
            className="mr-2"
            disabled={disabled}
            icon={<span className="align-middle h-5 w-7 pr-2 ">{sourceDataFromCatalog.pic}</span>}
            setAuthSecrets={setOauthSecretsToForms}
          >
            <span className="align-top">{`Log In to Fill OAuth Credentials`}</span>
          </OauthButton>
        </Col>
      </Row>
      <fieldset key="fields" disabled={disabled}>
        <SourceEditorFormConfigurationStaticFields
          editorMode={editorMode}
          initialValues={initialSourceData}
          patchConfig={patchConfig}
          setValidator={setStaticFieldsValidator}
          setFormReference={setFormReference}
        />
        {sourceConfigurationSchema.configurableFields && (
          <SourceEditorFormConfigurationConfigurableFields
            initialValues={initialSourceData}
            configParameters={sourceConfigurationSchema.configurableFields}
            patchConfig={patchConfig}
            setValidator={setConfigurableFieldsValidator}
            setFormReference={setFormReference}
          />
        )}
        {sourceConfigurationSchema.loadableFieldsEndpoint && (
          <SourceEditorFormConfigurationConfigurableLoadableFields
            initialValues={initialSourceData}
            sourceDataFromCatalog={sourceDataFromCatalog}
            patchConfig={patchConfig}
            setControlsDisabled={setControlsDisabled}
            setValidator={setConfigurableLoadableFieldsValidator}
            setFormReference={setFormReference}
          />
        )}
      </fieldset>
    </div>
  )
}

const Wrapped = observer(SourceEditorFormConfiguration)

Wrapped.displayName = "SourceEditorFormConfiguration"

export { Wrapped as SourceEditorFormConfiguration }

// @Helpers

const applyOauthValuesToForms = (forms: Forms, oauthValues: PlainObjectWithPrimitiveValues): void => {
  const oauthFieldsSuccessfullySet: string[] = []
  const oauthFieldsNotSet: string[] = []
  Object.entries(oauthValues).forEach(([oauthFieldKey, oauthFieldValue]) => {
    const [formToApplyValue, fieldKeyToApplyValue] = getFormAndKeyByOauthFieldKey(forms, oauthFieldKey)

    if (!formToApplyValue || !fieldKeyToApplyValue) {
      oauthFieldsNotSet.push(oauthFieldKey)
      return
    }

    const newValues = { ...formToApplyValue.getFieldsValue() }
    newValues[fieldKeyToApplyValue] = oauthFieldValue
    formToApplyValue.setFieldsValue(newValues)
    oauthFieldsSuccessfullySet.push(oauthFieldKey)
  })

  if (oauthFieldsSuccessfullySet.length > 0) {
    const secretsNamesSeparator = oauthFieldsSuccessfullySet.length === 2 ? " and " : ", "
    actionNotification.success(
      `Successfully pasted ${oauthFieldsSuccessfullySet
        .map(key => toTitleCase(key, { separator: "_" }))
        .join(secretsNamesSeparator)}`
    )
  }

  if (oauthFieldsNotSet.length > 0) {
    const isPossiblyInternalError: boolean = oauthFieldsSuccessfullySet.length > 0
    const messagePostfix = isPossiblyInternalError
      ? "If you believe that this is an error, please, contact us at support@jitsu.com or file an issue to our github."
      : "Did you forget to select OAuth authorization type?"
    const secretsNamesSeparator = oauthFieldsNotSet.length === 2 ? " and " : ", "
    const message = `Failed to paste ${oauthFieldsSuccessfullySet
      .map(key => toTitleCase(key, { separator: "_" }))
      .join(secretsNamesSeparator)} secret${oauthFieldsSuccessfullySet.length > 1 ? "s" : ""}. ${messagePostfix}`
    isPossiblyInternalError ? handleError(new Error(message)) : actionNotification.warn(message)
  }
}

const getFormAndKeyByOauthFieldKey = (
  forms: Forms,
  oauthFieldKey: string
): [FormInstance<PlainObjectWithPrimitiveValues> | null, string | null] => {
  let allFormsKeys: string[] = []
  const allFormsWithValues: {
    [key: string]: {
      form: FormInstance<PlainObjectWithPrimitiveValues>
      values: PlainObjectWithPrimitiveValues
    }
  } = Object.entries(forms).reduce((result, [formKey, form]) => {
    const values = form.getFieldsValue()
    allFormsKeys = [...allFormsKeys, ...Object.keys(values)]
    return {
      ...result,
      [formKey]: {
        form,
        values,
      },
    }
  }, {})

  const formKey =
    allFormsKeys.find(key => {
      const keyName = key.split(".").pop() // gets access_token from config.config.access_token
      return keyName === oauthFieldKey
    }) ?? null

  const { form } = formKey ? Object.values(allFormsWithValues).find(({ values }) => formKey in values) : { form: null }

  return [form, formKey]
}
