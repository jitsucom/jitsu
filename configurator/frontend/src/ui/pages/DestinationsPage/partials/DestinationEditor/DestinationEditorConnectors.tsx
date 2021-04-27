// @Libs
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Form } from 'antd';
// @Hooks
import useLoader from '@hooks/useLoader';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Components
import { ConnectedItems } from '@organism/ConnectedItems';
import { CenteredError, CenteredSpin } from '@./lib/components/components';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { Item } from '@organism/ConnectedItems/ConnectedItems';
// @Catalog sources
import { allSources } from '@catalog/sources/lib';
// @Constants
import { DESTINATIONS_CONNECTED_SOURCES } from '@./embeddedDocs/connectedSources';

export interface Props {
  form: FormInstance;
  initialValues: DestinationData;
}

const DestinationEditorConnectors = ({ form, initialValues }: Props) => {
  const service = ApplicationServices.get();

  const [sourcesError, sourcesData] = useLoader(async() => await service.storageService.get('sources', service.activeProject.id));
  const [APIKeysError, APIKeysData] = useLoader(async() => await service.storageService.get('api_keys', service.activeProject.id));
  console.log('APIKeysData: ', APIKeysData);

  const sourcesList = useMemo<Item[]>(
    () => sourcesData?.sources
      ? sourcesData?.sources?.map((source: SourceData) => {
        const proto = allSources.find(s => s.id === source.sourceType);

        return {
          id: source.sourceId,
          title: source.sourceId,
          icon: proto.pic
        };
      })
      : [],
    [sourcesData?.sources]
  );

  const apiKeysList = useMemo<Item[]>(
    () => APIKeysData?.keys
      ? APIKeysData?.keys?.map((key: APIKey) => ({
        title: key.uid,
        id: key.uid
      }))
      : [],
    [APIKeysData?.keys]
  );

  // if (error) {
  //   return <CenteredError error={error} />
  // } else if (!sourcesData) {
  //   return <CenteredSpin />
  // }

  return (
    <>
      <Form form={form} name="connected-sources">
        <h3>Choose sources</h3>
        <article className="mb-5">
          {DESTINATIONS_CONNECTED_SOURCES}
          {
            sourcesData?.sources?.length === 0 && <p>If you haven't added any connectors yet you can do it <Link to="/sources">here</Link>.</p>
          }
        </article>
        <ConnectedItems
          form={form}
          fieldName="_sources"
          itemsList={sourcesList}
          warningMessage={<p>Please, choose at least one source.</p>}
          initialValues={initialValues?._sources}
        />

        <h3>Choose API keys</h3>
        <ConnectedItems
          form={form}
          fieldName="_onlyKeys"
          itemsList={apiKeysList}
          warningMessage={<p>Please, choose at least one API key.</p>}
          initialValues={initialValues?._onlyKeys}
        />
      </Form>
    </>
  );
};

DestinationEditorConnectors.displayName = 'DestinationEditorConnectors';

export { DestinationEditorConnectors };
