// @Libs
import snakeCase from "lodash/snakeCase"
import merge from "lodash/merge"
import { FormInstance } from "antd"
// @Types
import { SourceConnector } from "catalog/sources/types"
// @Utils
import { getUniqueAutoIncId } from "utils/numbers"
import { handleError } from "lib/components/components"
import { toTitleCase } from "utils/strings"
// @Services
import ApplicationServices from "lib/services/ApplicationServices"
import Marshal from "lib/commons/marshalling"
// @Components
import { Tab } from "ui/components/Tabs/TabsConfigurator"
import { validateTabForm } from "utils/forms/validateTabForm"
import { makeObjectFromFieldsValues } from "utils/forms/marshalling"
import { SourceTabKey } from "ui/pages/SourcesPage/partials/SourceEditor/SourceEditorLegacy/SourceEditor"
import { Poll } from "utils/polling"
import { actionNotification } from "../../components/ActionNotification/ActionNotification"

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

  bringSourceData: ({
    sourcesTabs,
    sourceData,
    forceUpdate,
    options,
  }: {
    sourcesTabs: Tab<SourceTabKey>[]
    sourceData: any
    forceUpdate: any
    options?: {
      omitEmptyValues?: boolean
      skipValidation?: boolean
    }
  }) => {
    return Promise.all(
      sourcesTabs.map((tab: Tab) =>
        options?.skipValidation
          ? tab.form.getFieldsValue()
          : validateTabForm(tab, {
              forceUpdate,
              beforeValidate: () => (tab.errorsCount = 0),
              errorCb: errors => (tab.errorsCount = errors.errorFields?.length),
            })
      )
    ).then((allValues: [{ [key: string]: string }, CollectionSource[], string[]]) => {
      const enrichedData = {
        ...sourceData,
        ...allValues.reduce((result: any, current: any) => {
          return merge(
            result,
            makeObjectFromFieldsValues(current, {
              omitEmptyValues: options?.omitEmptyValues,
            })
          )
        }, {}),
      }

      if (enrichedData.collections) {
        enrichedData.collections = enrichedData.collections.map((collection: CollectionSource) => {
          if (!collection.parameters) {
            collection.parameters = {} as Array<{
              [key: string]: string[]
            }>
          }

          return collection
        })
      }

      return enrichedData
    })
  },
  testConnection: async (src: SourceData, hideMessage?: boolean) => {
    let connectionTestMessagePrefix: string | undefined
    try {
      const response = await ApplicationServices.get().backendApiClient.post("/sources/test", Marshal.toPureJson(src))

      if (response["status"] === "pending") {
        actionNotification.loading(
          "Please, allow some time for the connector source installation to complete. Once the connector source is installed, we will test the connection and send a push notification with the result."
        )

        connectionTestMessagePrefix = `Source ${src.sourceId} connection test result: `

        const POLLING_INTERVAL_MS = 2000
        const POLLING_TIMEOUT_MS = 60_000

        const poll = new Poll<void>(
          (end, fail) => async () => {
            try {
              const response = await ApplicationServices.get().backendApiClient.post(
                "/sources/test",
                Marshal.toPureJson(src)
              )

              if (response["status"] !== "pending") end()
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
        connectedErrorMessage: undefined,
      }
    } catch (error) {
      if (!hideMessage) {
        const message = "Connection test failed"
        const prefixedMessage = connectionTestMessagePrefix
          ? `${connectionTestMessagePrefix}${message.toLowerCase()}`
          : message
        handleError(error, prefixedMessage)
      }

      return {
        connected: false,
        connectedErrorMessage: error.message ?? "Failed to connect",
      }
    }
  },
  applyOauthValuesToAntdForms: (
    forms: { [key: string]: FormInstance<PlainObjectWithPrimitiveValues> },
    oauthValues: PlainObjectWithPrimitiveValues
  ): void => {
    const oauthFieldsSuccessfullySet: string[] = []
    const oauthFieldsNotSet: string[] = []
    Object.entries(oauthValues).forEach(([oauthFieldKey, oauthFieldValue]) => {
      const [formToApplyValue, fieldKeyToApplyValue] = getAntdFormAndKeyByOauthFieldKey(forms, oauthFieldKey)

      if (!formToApplyValue || !fieldKeyToApplyValue) {
        oauthFieldsNotSet.push(oauthFieldKey)
        return
      }

      const newValues = { ...formToApplyValue.getFieldsValue() }
      newValues[fieldKeyToApplyValue] = oauthFieldValue
      formToApplyValue.setFieldsValue(newValues)
      oauthFieldsSuccessfullySet.push(oauthFieldKey)
    })

    debugger

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
      const message = `Failed to paste ${oauthFieldsNotSet
        .map(key => toTitleCase(key, { separator: "_" }))
        .join(secretsNamesSeparator)} secret${oauthFieldsNotSet.length > 1 ? "s" : ""}. ${messagePostfix}`
      isPossiblyInternalError ? handleError(new Error(message)) : actionNotification.warn(message)
    }
  },
}

const getAntdFormAndKeyByOauthFieldKey = (
  forms: { [key: string]: FormInstance<PlainObjectWithPrimitiveValues> },
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
