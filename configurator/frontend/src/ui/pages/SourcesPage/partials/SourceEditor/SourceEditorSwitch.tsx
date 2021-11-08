// @Libs
import { useMemo } from "react"
import { snakeCase } from "lodash"
import { useParams } from "react-router"
// @Store
import { sourcesStore } from "stores/sources"
// @Catalog
import { allSources as sourcesCatalog } from "catalog/sources/lib"
// @Components
import { SourceEditor as SourceEditorNew } from "./SourceEditor/SourceEditor"
import { SourceEditor as SourceEditorLegacy } from "./SourceEditorLegacy/SourceEditor"
// @Types
import { SourceConnector } from "catalog/sources/types"
import { CommonSourcePageProps } from "ui/pages/SourcesPage/SourcesPage"

/**
 * This component is a temporary switch between the new and the legacy
 * implementations of the SourceEditor component.
 *
 * Do not pass the data obtained here to the children components.
 */
export const SourceEditorSwitch: React.FC<CommonSourcePageProps> = props => {
  const { source, sourceId } = useParams<{ source?: string; sourceId?: string; tabName?: string }>()

  const connectorSource = useMemo<SourceConnector>(() => {
    let sourceType = source
      ? source
      : sourceId
      ? sourcesStore.sources.find(src => src.sourceId === sourceId)?.sourceProtoType
      : undefined

    return sourceType
      ? sourcesCatalog.find((source: SourceConnector) => snakeCase(source.id) === snakeCase(sourceType))
      : undefined
  }, [source, sourceId])

  return connectorSource.protoType === "airbyte" || connectorSource.protoType === "singer" ? (
    <SourceEditorNew {...props} />
  ) : (
    <SourceEditorLegacy {...props} /> // Legacy
  )
}
