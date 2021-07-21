// @Libs
import { memo } from 'react';
// @Data
import { destinationsReferenceMap } from 'ui/pages/DestinationsPage/commons';
import { allSources } from 'catalog/sources/lib';

type EntityIconProps = DestinationIconProps | SourceIconProps | ApiKeyIconProps;

type DestinationIconProps = {
  entityType: 'destination';
  entitySubType: DestinationType;
};

type SourceIconProps = {
  entityType: 'source';
  entitySubType: string;
};

type ApiKeyIconProps = {
  entityType: 'api_key';
  entitySubType?: undefined;
};

const EntityIconComponent: React.FC<EntityIconProps> = ({
  entityType,
  entitySubType
}) => {
  switch (entityType) {
    case 'source':
      return allSources.find(({ id }) => id === entitySubType)?.pic;
    case 'destination':
      return destinationsReferenceMap[entitySubType].ui.icon;
    case 'api_key':
      return null;
    default:
      return null;
  }
};

export const EntityIcon = memo(EntityIconComponent);
