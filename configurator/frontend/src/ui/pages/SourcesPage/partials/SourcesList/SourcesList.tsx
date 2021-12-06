// @Libs
import { useCallback, useEffect, useMemo } from "react"
import { useHistory } from "react-router-dom"
import { Button } from "antd"
import { observer } from "mobx-react-lite"
import snakeCase from "lodash/snakeCase"
// @Store
import { sourcesStore } from "stores/sources"
// @Icons
import PlusOutlined from "@ant-design/icons/lib/icons/PlusOutlined"
// @Services
import ApplicationServices from "lib/services/ApplicationServices"
// @Types
import { SourceConnector } from "catalog/sources/types"
import { CommonSourcePageProps } from "ui/pages/SourcesPage/SourcesPage"
import { withHome } from "ui/components/Breadcrumbs/Breadcrumbs"
// @Styles
import styles from "./SourcesList.module.less"
// @Routes
import { sourcesPageRoutes } from "ui/pages/SourcesPage/SourcesPage.routes"
// @Utils
import { showQuotaLimitModal } from "../../../../../lib/services/billing"
import { SourceCard } from "../../../../components/SourceCard/SourceCard"

const SourcesListComponent = ({ setBreadcrumbs }: CommonSourcePageProps) => {
  const history = useHistory()

  const services = useMemo(() => ApplicationServices.get(), [])

  const handleAddClick = useCallback(() => {
    services.features.billingEnabled
    if (
      sourcesStore.sources.length >= (services.currentSubscription?.currentPlan.quota.sources ?? 999) &&
      !services.currentSubscription.doNotBlock
    ) {
      showQuotaLimitModal(
        services.currentSubscription,
        <>You current plan allows to have only {services.currentSubscription.currentPlan.quota.sources} sources</>
      )
      return
    }
    history.push(sourcesPageRoutes.add)
  }, [history])

  useEffect(() => {
    setBreadcrumbs(
      withHome({
        elements: [
          { title: "Sources", link: sourcesPageRoutes.root },
          {
            title: "Sources List",
          },
        ],
      })
    )
  }, [setBreadcrumbs])

  if (sourcesStore.sources.length === 0) {
    return (
      <div className={styles.empty}>
        <h3 className="text-2xl">Sources list is still empty</h3>
        <div>
          <Button type="primary" size="large" icon={<PlusOutlined />} onClick={handleAddClick}>
            Add source
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="mb-5">
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAddClick}>
          Add source
        </Button>
      </div>

      <div className="flex flex-wrap justify-center">
        {sourcesStore.sources.map((src: SourceData) => (
          <SourceCard key={src.sourceId} src={src} />
        ))}
      </div>
    </>
  )
}

const SourcesList = observer(SourcesListComponent)

SourcesList.displayName = "SourcesList"

export { SourcesList }
