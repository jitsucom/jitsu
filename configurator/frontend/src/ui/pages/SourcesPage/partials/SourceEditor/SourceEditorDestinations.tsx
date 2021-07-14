// @Libs
import { useCallback, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { Form } from 'antd';
// @Constants
import { SOURCE_CONNECTED_DESTINATION } from 'embeddedDocs/sourcesConnectedItems';
// @Components
import {
  NameWithPicture,
  ConnectedItem,
  ConnectedItems
} from 'ui/components/ConnectedItems/ConnectedItems';
import { TabDescription } from 'ui/components/Tabs/TabDescription';
// @Services
import ApplicationServices from 'lib/services/ApplicationServices';
import { destinationsReferenceMap } from 'ui/pages/DestinationsPage/commons';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { Destination } from 'catalog/destinations/types';
// @Utils
import { destinationsUtils } from 'ui/pages/DestinationsPage/DestinationsPage.utils';
import { destinationsStore } from 'stores/destinationsStore';

export interface Props {
  form: FormInstance;
  initialValues: SourceData;
  handleTouchAnyField: VoidFunc;
}

function getDescription(reference: Destination) {
  if (reference.syncFromSourcesStatus === 'supported') {
    return null;
  } else if (reference.syncFromSourcesStatus === 'coming_soon') {
    return `${reference.displayName} synchronization is coming soon! At the moment, it's not available`;
  } else {
    return `${reference.displayName} synchronization is not supported`;
  }
}

const SourceEditorDestinationsComponent = ({
  form,
  initialValues,
  handleTouchAnyField
}: Props) => {
  const destinations = destinationsStore.destinations;

  const destinationsList = useMemo<ConnectedItem[]>(
    () =>
      destinations?.map((dst: DestinationData) => {
        const reference = destinationsReferenceMap[dst._type];
        return {
          id: dst._uid,
          disabled:
            reference.syncFromSourcesStatus === 'coming_soon' ||
            reference.syncFromSourcesStatus === 'not_supported',
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
    () => initialValues?.destinations ?? [],
    [initialValues]
  );

  const handleItemChange = useCallback(
    (items: string[]) => {
      const beenTouched =
        JSON.stringify(items) !== JSON.stringify(initialValues.destinations);

      handleTouchAnyField(beenTouched);
    },
    [initialValues, handleTouchAnyField]
  );

  return (
    <>
      <TabDescription>{SOURCE_CONNECTED_DESTINATION}</TabDescription>

      <Form form={form} name="connected-destinations">
        <ConnectedItems
          form={form}
          fieldName="destinations"
          itemsList={destinationsList}
          warningMessage={<p>Please, choose at least one source.</p>}
          initialValues={preparedInitialValue}
          handleItemChange={handleItemChange}
        />
      </Form>
    </>
  );
};

const SourceEditorDestinations = observer(SourceEditorDestinationsComponent);

SourceEditorDestinations.displayName = 'SourceEditorDestinations';

export { SourceEditorDestinations };
