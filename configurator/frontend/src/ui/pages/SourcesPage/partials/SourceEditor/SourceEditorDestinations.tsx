// @Libs
import React, { useMemo } from 'react';
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
import { Item } from '@organism/ConnectedItems/ConnectedItems';
// @Hooks
import useLoader from '@hooks/useLoader';

export interface Props {
  form: FormInstance;
  initialValues: SourceData;
  projectId: string;
}

const SourceEditorDestinations = ({ form, initialValues, projectId }: Props) => {
  const services = useMemo(() => ApplicationServices.get(), []);

  const [, destinations] = useLoader(
    async() => await services.storageService.get('destinations', projectId)
  );

  const destinationsList = useMemo<Item[]>(() => destinations?.destinations?.map((dst: DestinationData) => {
    const reference = destinationsReferenceMap[dst._type]
    return {
      id: reference.id,
      title: reference.displayName,
      icon: reference.ui.icon
    };
  }) ?? [], [destinations?.destinations]);

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
