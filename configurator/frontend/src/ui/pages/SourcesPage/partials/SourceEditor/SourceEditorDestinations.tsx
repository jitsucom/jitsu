// @Libs
import React, { useCallback, useMemo } from 'react';
import { generatePath, useHistory } from 'react-router-dom';
import { Form } from 'antd';
// @Constants
import { SOURCE_CONNECTED_DESTINATION } from '@./embeddedDocs/sourcesConnectedItems';
// @Components
import { ConnectedItems } from '@organism/ConnectedItems';
// @Services
import ApplicationServices from '@service/ApplicationServices';
import { destinationsReferenceMap } from '@page/DestinationsPage/commons';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { ConnectedItem } from '@organism/ConnectedItems';
// @Hooks
import useLoader from '@hooks/useLoader';
// @Routes
import { destinationPageRoutes } from '@page/DestinationsPage/DestinationsPage.routes';
// @Utils
import { destinationsUtils } from '@page/DestinationsPage/DestinationsPage.utils';
import { NameWithPicture } from '@organism/ConnectedItems/ConnectedItems';
import { Destination } from '@catalog/destinations/types';

export interface Props {
  form: FormInstance;
  initialValues: SourceData;
  projectId: string;
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

const SourceEditorDestinations = ({ form, initialValues, projectId }: Props) => {
  const history = useHistory();

  const services = useMemo(() => ApplicationServices.get(), []);

  const [, destinations] = useLoader(
    async() => await services.storageService.get('destinations', projectId)
  );

  const handleEditAction = useCallback((id: string) => () => history.push(generatePath(destinationPageRoutes.editDestination, { id })), [history]);

  const destinationsList = useMemo<ConnectedItem[]>(() => destinations?.destinations?.map((dst: DestinationData) => {
    const reference = destinationsReferenceMap[dst._type]
    return {
      id: dst._uid,
      disabled: reference.syncFromSourcesStatus === 'coming_soon' || reference.syncFromSourcesStatus === 'not_supported',
      title: <NameWithPicture icon={reference.ui.icon}><b>{reference.displayName}</b>: {destinationsUtils.getTitle(dst)}</NameWithPicture>,
      description: <i className="text-xs">{getDescription(reference)}</i>
    };
  }) ?? [], [destinations?.destinations, handleEditAction]);

  const preparedInitialValue = useMemo(() => initialValues?.destinations ?? [], [initialValues]);

  return (
    <>
      <article className="mb-5 text-sm text-secondaryText">
        {SOURCE_CONNECTED_DESTINATION}
      </article>

      <Form form={form} name="connected-destinations">
        <ConnectedItems
          form={form}
          fieldName="destinations"
          itemsList={destinationsList}
          warningMessage={<p>Please, choose at least one source.</p>}
          initialValues={preparedInitialValue}
        />
      </Form>
    </>
  );
};

SourceEditorDestinations.displayName = 'SourceEditorDestinations';

export { SourceEditorDestinations };
