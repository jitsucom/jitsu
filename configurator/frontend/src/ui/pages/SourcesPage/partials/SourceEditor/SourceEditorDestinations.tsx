// @Libs
import React, { useCallback, useMemo } from 'react';
import { generatePath, useHistory } from 'react-router-dom';
import { Form } from 'antd';
// @Constants
import { SOURCE_CONNECTED_DESTINATION } from '@./embeddedDocs/connectedDestinations';
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

export interface Props {
  form: FormInstance;
  initialValues: SourceData;
  projectId: string;
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
      itemKey: dst._uid,
      id: dst._uid,
      additional: destinationsUtils.getMode(dst._mode),
      description: destinationsUtils.getDescription(reference, dst),
      title: destinationsUtils.getTitle(dst),
      icon: reference.ui.icon,
      actions: [{ key: 'edit', method: handleEditAction, title: 'Edit' }]
    };
  }) ?? [], [destinations?.destinations, handleEditAction]);

  const preparedInitialValue = useMemo(() => initialValues?.destinations ?? [], [initialValues]);

  return (
    <>
      <h3>Choose connectors</h3>
      <article className="mb-5">
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
