// @Libs
import { memo, PropsWithChildren } from "react"
// @Data
import { destinationsReferenceMap, DestinationType } from "@jitsu/catalog"
import { allSourcesMap } from "@jitsu/catalog"
import { apiKeysReferenceMap } from "@jitsu/catalog"

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
      return <>{allSourcesMap[entitySubType]?.pic}</>
    case "destination":
      return <>{destinationsReferenceMap[entitySubType]?.ui?.icon}</>
    case "api_key":
      return <>{apiKeysReferenceMap.js.icon}</>
    default:
      return <></>
  }
}

export const EntityIcon = memo(EntityIconComponent)
