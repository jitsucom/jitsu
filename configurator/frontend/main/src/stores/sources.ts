import { EntitiesStore } from "./entitiesStore"

export type SourcesStore = EntitiesStore<SourceData>

export const sourcesStore = new EntitiesStore<SourceData>("sources", { idField: "sourceId" })
