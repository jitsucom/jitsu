import ApplicationServices from "lib/services/ApplicationServices"
import Marshal from "lib/commons/marshalling"
import { handleError } from "lib/components/components"
import { Tab } from "ui/components/Tabs/TabsConfigurator"
import { actionNotification } from "../../../../components/ActionNotification/ActionNotification"

const destinationEditorUtils = {
  testConnection: async (dst: DestinationData, hideMessage?: boolean) => {
    try {
      await ApplicationServices.get().backendApiClient.post("/destinations/test", Marshal.toPureJson(dst))

      dst._connectionTestOk = true

      if (!hideMessage) {
        actionNotification.info("Successfully connected!")
      }
    } catch (error) {
      dst._connectionTestOk = false
      dst._connectionErrorMessage = error.message ?? "Failed to connect"

      if (!hideMessage) {
        handleError(error, "Connection failed")
      }
    }
  },
  getPromptMessage: (tabs: Tab[], location): string => {
    if (location?.state?.disablePrompt) {
      return undefined
    }
    return tabs.some(tab => tab.touched) ? "You have unsaved changes. Are you sure you want to leave the page?" : undefined
  },
}

export { destinationEditorUtils }
