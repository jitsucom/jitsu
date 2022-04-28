// @Libs
import snakeCase from "lodash/snakeCase"
import { FormInstance } from "antd"
// @Types
import { SourceConnector } from "@jitsu/catalog/sources/types"
// @Utils
import { getUniqueAutoIncId } from "utils/numbers"
import { handleError } from "lib/components/components"
import { toTitleCase } from "utils/strings"
// @Services
import ApplicationServices from "lib/services/ApplicationServices"
import Marshal from "lib/commons/marshalling"
// @Components
import { Tab } from "ui/components/Tabs/TabsConfigurator"
import { Poll } from "utils/polling"
import { actionNotification } from "../../components/ActionNotification/ActionNotification"

export type TestConnectionResponse = {
  connected: boolean
  connectedErrorType?: TestConnectionErrorType
  connectedErrorMessage?: string
  connectedErrorPayload?: any
}
type TestConnectionErrorType = "general" | "streams_changed"

const sourcePageUtils = {
  getSourceType: (sourceConnector: SourceConnector) =>
    sourceConnector?.protoType ? sourceConnector?.protoType : snakeCase(sourceConnector?.id),
  getSourcePrototype: (sourceConnector: SourceConnector): string => snakeCase(sourceConnector?.id),
  getSourceId: (sourceProtoType: string, sourcesIds: string[]) => {
    sourceProtoType = sourceProtoType.replace("airbyte-source-", "").replace("singer-tap-", "")
    const isUniqueSourceId = !sourcesIds.find(id => id === sourceProtoType)

    if (isUniqueSourceId) {
      return sourceProtoType
    }

    return getUniqueAutoIncId(sourceProtoType, sourcesIds)
  },
  getPromptMessage: (tabs: Tab[]) => () =>
    tabs.some(tab => tab.touched) ? "You have unsaved changes. Are you sure you want to leave the page?" : undefined,

  testConnection: async (
    projectId: string,
    src: SourceData,
    hideMessage?: boolean,
    _options?: { skipHandleError?: boolean }
  ): Promise<TestConnectionResponse> => {
    const options = _options ?? {}
    let connectionTestMessagePrefix: string | undefined
    try {
      const sourceData = { ...src, sourceId: projectId + "." + src.sourceId }
      const response = await ApplicationServices.get().backendApiClient.post(
        "/sources/test",
        Marshal.toPureJson(sourceData)
      )

      if (response["status"] === "pending") {
        actionNotification.loading(
          "Please, allow some time for the connector source installation to complete. Once the connector source is installed, we will test the connection and send a push notification with the result."
        )

        connectionTestMessagePrefix = `Source ${sourceData.sourceId} connection test result: `

        const POLLING_INTERVAL_MS = 2000
        const POLLING_TIMEOUT_MS = 60_000

        const poll = new Poll<void>(
          (end, fail) => async () => {
            try {
              const response = await ApplicationServices.get().backendApiClient.post(
                "/sources/test",
                Marshal.toPureJson(sourceData)
              )
              const status = response["status"]
              if (status !== "pending") end()
              else if (status !== "ok")
                fail(new Error(`Tap connection test returned an error. ${response["error"] ?? "Unknown error."}`))
            } catch (error) {
              fail(error)
            }
          },
          POLLING_INTERVAL_MS,
          POLLING_TIMEOUT_MS
        )

        poll.start()
        await poll.wait()
      }

      if (!hideMessage) {
        const message = "Successfully connected"
        actionNotification.success(
          connectionTestMessagePrefix ? `${connectionTestMessagePrefix}${message.toLowerCase()}` : message
        )
      }

      return {
        connected: true,
        connectedErrorType: undefined,
        connectedErrorMessage: undefined,
        connectedErrorPayload: undefined,
      }
    } catch (error) {
      if (!hideMessage) {
        const message = "Connection test failed"
        const prefixedMessage = connectionTestMessagePrefix
          ? `${connectionTestMessagePrefix}${message.toLowerCase()}`
          : message
        if (!options.skipHandleError) handleError(error, prefixedMessage)
      }

      const errorType: TestConnectionErrorType = `${error}`.includes("selected streams unavailable")
        ? "streams_changed"
        : "general"

      return {
        connected: false,
        connectedErrorType: errorType,
        connectedErrorMessage: error.message ?? "Failed to connect",
        connectedErrorPayload: error._response?.payload,
      }
    }
  },
  applyOauthValuesToAntdForms: (
    forms: {
      [key: string]: {
        form: FormInstance<PlainObjectWithPrimitiveValues>
        patchConfigOnFormValuesChange?: (values: PlainObjectWithPrimitiveValues) => void
      }
    },
    oauthValues: PlainObjectWithPrimitiveValues
  ): boolean => {
    const oauthFieldsSuccessfullySet: string[] = []
    const oauthFieldsNotSet: string[] = []
    Object.entries(oauthValues).forEach(([oauthFieldKey, oauthFieldValue]) => {
      const [formToApplyValue, fieldKeyToApplyValue] = getAntdFormAndKeyByOauthFieldKey(forms, oauthFieldKey)

      if (!formToApplyValue || !fieldKeyToApplyValue) {
        oauthFieldsNotSet.push(oauthFieldKey)
        return
      }

      const newValues = { ...formToApplyValue.form.getFieldsValue() }
      newValues[fieldKeyToApplyValue] = oauthFieldValue
      formToApplyValue.form.setFieldsValue(newValues)
      formToApplyValue.patchConfigOnFormValuesChange?.(newValues)
      oauthFieldsSuccessfullySet.push(oauthFieldKey)
    })

    if (oauthFieldsSuccessfullySet.length > 0) {
      actionNotification.success(`Authorization Successful`)
      return true
    }

    /* handles the case when failed to set all fields */
    if (oauthFieldsNotSet.length > 0 && oauthFieldsSuccessfullySet.length === 0) {
      const messagePostfix =
        "Did you forget to select OAuth authorization type in the form below? If you believe that this is an error, please, contact us at support@jitsu.com or file an issue to our github."
      const secretsNamesSeparator = oauthFieldsNotSet.length === 2 ? " and " : ", "
      const message = `Failed to paste ${oauthFieldsNotSet
        .map(key => toTitleCase(key, { separator: "_" }))
        .join(secretsNamesSeparator)} secret${oauthFieldsNotSet.length > 1 ? "s" : ""}. ${messagePostfix}`
      actionNotification.warn(message)
      return false
    }
  },
}

const getAntdFormAndKeyByOauthFieldKey = (
  forms: {
    [key: string]: {
      form: FormInstance<PlainObjectWithPrimitiveValues>
      patchConfigOnFormValuesChange?: (values: PlainObjectWithPrimitiveValues) => void
    }
  },
  oauthFieldKey: string
): [
  {
    form: FormInstance<PlainObjectWithPrimitiveValues>
    patchConfigOnFormValuesChange?: (values: PlainObjectWithPrimitiveValues) => void
  } | null,
  string | null
] => {
  let allFormsKeys: string[] = []
  const allFormsWithValues: {
    [key: string]: {
      form: {
        form: FormInstance<PlainObjectWithPrimitiveValues>
        patchConfigOnFormValuesChange?: (values: PlainObjectWithPrimitiveValues) => void
      }
      values: PlainObjectWithPrimitiveValues
    }
  } = Object.entries(forms).reduce((result, [formKey, formData]) => {
    const values = formData.form.getFieldsValue()
    allFormsKeys = [...allFormsKeys, ...Object.keys(values)]
    return {
      ...result,
      [formKey]: {
        form: formData,
        values,
      },
    }
  }, {})

  const formKey =
    allFormsKeys.find(_formKey => {
      const formKeyNameEnd = _formKey.split(".").pop() // gets access_token from config.config.access_token
      const formKey = formKeyNameEnd.replace("_", "").toLowerCase() // viewid <- viewId, accesstoken <- access_token
      const parsedOauthFieldKey = oauthFieldKey.replace("_", "").toLowerCase()
      return formKey === parsedOauthFieldKey
    }) ?? null

  const { form } = formKey ? Object.values(allFormsWithValues).find(({ values }) => formKey in values) : { form: null }

  return [form, formKey]
}

export { sourcePageUtils }
