// @Libs
import { memo } from "react"
// @Data
import { destinationsReferenceMap } from "@jitsu/catalog/destinations/lib"
import { allSourcesMap } from "@jitsu/catalog/sources/lib"
import { apiKeysReferenceMap } from "@jitsu/catalog/apiKeys/lib"

type EntityIconProps = DestinationIconProps | SourceIconProps | ApiKeyIconProps

type DestinationIconProps = {
  entityType: "destination"
  entitySubType: DestinationType
}

type SourceIconProps = {
  entityType: "source"
  entitySubType: string
}

type ApiKeyIconProps = {
  entityType: "api_key"
  entitySubType?: undefined
}

const EntityIconComponent = ({ entityType, entitySubType = undefined }: EntityIconProps) => {
  switch (entityType) {
    case "source":
      return allSourcesMap[entitySubType]?.pic || null
    case "destination":
      return destinationsReferenceMap[entitySubType]?.ui?.icon || null
    case "api_key":
      return apiKeysReferenceMap.js.icon || null
    default:
      return null
  }
}

export const EntityIcon = memo(EntityIconComponent)
