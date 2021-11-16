// @Libs
import snakeCase from "lodash/snakeCase"
import merge from "lodash/merge"
// @Types
import { SourceConnector } from "catalog/sources/types"
// @Utils
import { getUniqueAutoIncId } from "utils/numbers"
import { handleError } from "lib/components/components"
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
    sourceProtoType = sourceProtoType.replace('airbyte-source-', '').replace('singer-tap-', '')
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
}

export { sourcePageUtils }
