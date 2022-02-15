import { createEntitiesStore } from "./createEntitiesStore"

export const destinationsStore: EntitiesStore<DestinationData>  = createEntitiesStore<DestinationData>('destinations');
