import { destinationsStore } from "../../../stores/destinations"
import { destinationsReferenceMap } from "@jitsu/catalog/destinations/lib"
import { apiKeysStore } from "../../../stores/apiKeys"
import { apiKeysReferenceMap } from "@jitsu/catalog/apiKeys/lib"
import { sourcesStore } from "../../../stores/sources"
import { EventStatus } from "../EventsStream/shared"

export type FilterOption = {
  value: string
  label: any
  icon?: any
}

export const getAllDestinationsAsOptions = (includeAllOption = false) => {
  const options = destinationsStore.listIncludeHidden.map(d => {
    const icon = destinationsReferenceMap[d._type]?.ui.icon
    return { value: d._uid, label: d.displayName ?? d._id, icon } as FilterOption
  })
  if (includeAllOption) {
    options.unshift({ label: "All destinations", value: EventStatus.All })
  }
  return options
}

export const getAllApiKeysAsOptions = (includeAllOption = false) => {
  const options = apiKeysStore.list.map(key => {
    return { value: key.uid, label: key.comment ?? key.uid, icon: apiKeysReferenceMap.js.icon } as FilterOption
  })
  if (includeAllOption) {
    options.unshift({ label: "All API keys", value: EventStatus.All })
  }
  return options
}

export const getAllSourcesAsOptions = (includeAllOption = false) => {
  const options = sourcesStore.list.map(source => {
    return { value: source.sourceId, label: source.displayName ?? source.sourceId } as FilterOption
  })
  if (includeAllOption) {
    options.unshift({ label: "All sources", value: EventStatus.All })
  }
  return options
}
