// @Libs
import { useCallback, useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
// @Store
import { destinationsStore } from 'stores/destinations';
// @Catalog
import { destinationsReferenceMap } from 'catalog/destinations/lib';
// @Components
import { SourceEditorFormConnectionsView } from './SourceEditorFormConnectionsView';
// @Types
import { Destination } from 'catalog/destinations/types';
import {
  AddConnection,
  RemoveConnection,
  SetConnections
} from './SourceEditor';
// @Utils
import { destinationsUtils } from 'ui/pages/DestinationsPage/DestinationsPage.utils';

type Props = {
  initialSourceDataFromBackend: Optional<Partial<SourceData>>;
  addConnection: AddConnection;
  removeConnection: RemoveConnection;
  setConnections: SetConnections;
};

export interface ConnectedItem {
  id: string;
  disabled?: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
}

const CONNECTIONS_SOURCEDATA_PATH = 'destinations';

const SourceEditorFormConnectionsComponent: React.FC<Props> = ({
  initialSourceDataFromBackend,
  addConnection,
  removeConnection,
  setConnections
}) => {
  const destinations = destinationsStore.destinations;

  const destinationsList = useMemo<ConnectedItem[]>(
    () =>
      destinations?.map((dst: DestinationData) => {
        const reference = destinationsReferenceMap[dst._type];
        return {
          id: dst._uid,
          disabled: reference.syncFromSourcesStatus !== 'supported',
          title: (
            <NameWithPicture icon={reference.ui.icon}>
              <b>{reference.displayName}</b>: {destinationsUtils.getTitle(dst)}
            </NameWithPicture>
          ),
          description: <i className="text-xs">{getDescription(reference)}</i>
        };
      }) ?? [],
    [destinations]
  );

  const preparedInitialValue = useMemo(
    () => initialSourceDataFromBackend?.destinations ?? [],
    [initialSourceDataFromBackend]
  );

  const handleChange = useCallback(
    (connections: string[]) => {
      setConnections(CONNECTIONS_SOURCEDATA_PATH, connections);
    },
    [setConnections]
  );

  useEffect(() => {
    setConnections(CONNECTIONS_SOURCEDATA_PATH, preparedInitialValue);
  }, []);

  return (
    <SourceEditorFormConnectionsView
      itemsList={destinationsList}
      initialValues={preparedInitialValue}
      handleItemChange={handleChange}
    />
  );
};

const SourceEditorFormConnections = observer(
  SourceEditorFormConnectionsComponent
);

SourceEditorFormConnections.displayName = 'SourceEditorFormConnections';

export { SourceEditorFormConnections };

/** */

/**
 * Helpers
 */

/** */

function getDescription(reference: Destination) {
  if (reference.syncFromSourcesStatus === 'supported') {
    return null;
  } else if (reference.syncFromSourcesStatus === 'coming_soon') {
    return `${reference.displayName} synchronization is coming soon! At the moment, it's not available`;
  } else {
    return `${reference.displayName} synchronization is not supported`;
  }
}

const NameWithPicture: React.FC<{
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ icon, children }) => {
  return (
    <span>
      <span className="w-6 inline-block align-middle">
        <span className="flex items-center justify-center pr-1">{icon}</span>
      </span>
      <span className="inline-block align-middle">{children}</span>
    </span>
  );
};
