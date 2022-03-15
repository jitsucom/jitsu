// @Libs
import { Button } from "antd"
import { observer } from "mobx-react-lite"
import { useEffect, useState } from "react"
// @Services
import ApplicationServices from "lib/services/ApplicationServices"
// @Components
import { OnboardingClientDocs } from "./OnboardingClientDocs"
// @Store
import { apiKeysStore } from "stores/apiKeys"
import { destinationsStore } from "stores/destinations"
// @Styles
import styles from "./OnboardingTourAddJitsuOnClient.module.less"
import { connectionsHelper } from "stores/helpers"

type Props = {
  handleGoNext: () => void
  handleGoBack?: () => void
}

export const OnboardingTourAddJitsuOnClient: React.FC<Props> = observer(({ handleGoNext, handleGoBack }) => {
  const [apiKey, setApiKey] = useState<ApiKey | null>(null)

  useEffect(() => {
    const getLinkedApiKey = async (): Promise<void> => {
      const services = ApplicationServices.get()

      const linkedDestination = destinationsStore.listIncludeHidden.find(dst => dst._onlyKeys.length)
      const linkedKey = linkedDestination ? apiKeysStore.get(linkedDestination._onlyKeys[0]) : null
      if (linkedKey) {
        setApiKey(linkedKey)
        return
      }

      let unlinkedKey = apiKeysStore.list[0]

      // at this point, all destinations can only be unlinked (or null)
      const unlinkedDestination = destinationsStore.list[0]
      const appIsCloudHosted = services.features.environment === "jitsu_cloud"

      if (!unlinkedDestination && appIsCloudHosted) {
        // error - user can not arrive here without destinations unless he is self-hosted
        const errorMessage = "jitsu_cloud user appeared on Onboarding Client Docs without any destinations set up"
        console.error(errorMessage)
        services.analyticsService.track("onboarding_client_docs_error", {
          error: errorMessage,
        })
        return
      }

      // can only happen to self-hosted user who has skipped the database step
      if (!unlinkedDestination) return

      await connectionsHelper.updateDestinationsConnectionsToApiKey(unlinkedKey.uid, [unlinkedDestination._uid])
      setApiKey(unlinkedKey)
    }

    getLinkedApiKey()
  }, [])

  return (
    <div className={styles.mainContainer}>
      <h1 className={styles.header}>{"🖥 Add Jitsu on Client"}</h1>
      <div className={styles.contentContainer}>
        <OnboardingClientDocs
          token={
            apiKey || {
              uid: "loading...",
              jsAuth: "loading...",
              serverAuth: "loading...",
              origins: ["loading..."],
              comment: "loading...",
            }
          }
        />
      </div>
      <div className={styles.controlsContainer}>
        {!!handleGoBack && (
          <Button type="ghost" size="large" className={styles.withButtonsMargins} onClick={handleGoBack}>
            {"Back"}
          </Button>
        )}
        <Button type="primary" size="large" className={styles.withButtonsMargins} onClick={handleGoNext}>
          {"Got it"}
        </Button>
      </div>
    </div>
  )
})
