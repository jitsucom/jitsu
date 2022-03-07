// @Libs
import { useCallback, useEffect } from "react"
import { useHistory } from "react-router-dom"
import { Button } from "antd"
import { observer } from "mobx-react-lite"
// @Store
import { sourcesStore } from "stores/sources"
// @Icons
import PlusOutlined from "@ant-design/icons/lib/icons/PlusOutlined"
// @Styles
import styles from "./SourcesList.module.less"
// @Routes
import { sourcesPageRoutes } from "ui/pages/SourcesPage/SourcesPage.routes"
// @Utils
import { SourceCard } from "../../../../components/SourceCard/SourceCard"
import { currentPageHeaderStore } from "../../../../../stores/currentPageHeader"
import ProjectLink from "lib/components/ProjectLink/ProjectLink"

const SourcesListComponent = () => {
  useEffect(() => {
    currentPageHeaderStore.setBreadcrumbs("Sources")
  }, [])

  if (sourcesStore.list.length === 0) {
    return (
      <div className={styles.empty}>
        <h3 className="text-2xl">Sources list is still empty</h3>
        <div>
          <ProjectLink to={sourcesPageRoutes.add}>
            <Button type="primary" size="large" icon={<PlusOutlined />}>
              Add source
            </Button>
          </ProjectLink>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="mb-5">
        <ProjectLink to={sourcesPageRoutes.add}>
          <Button type="primary" icon={<PlusOutlined />}>
            Add source
          </Button>
        </ProjectLink>
      </div>

      <div className="flex flex-wrap justify-center">
        {sourcesStore.list.map((src: SourceData) => (
          <SourceCard key={src.sourceId} src={src} />
        ))}
      </div>
    </>
  )
}

const SourcesList = observer(SourcesListComponent)

SourcesList.displayName = "SourcesList"

export { SourcesList }
