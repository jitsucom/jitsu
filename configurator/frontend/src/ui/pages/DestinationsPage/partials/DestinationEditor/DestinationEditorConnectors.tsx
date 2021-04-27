// @Libs
import React, { useMemo } from 'react';
import { generatePath, Link } from 'react-router-dom';
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
import { ConnectedItem } from '@organism/ConnectedItems';
// @Catalog sources
import { allSources } from '@catalog/sources/lib';
// @Constants
import { DESTINATIONS_CONNECTED_SOURCES } from '@./embeddedDocs/connectedSources';
// @Routes
import { sourcesPageRoutes } from '@page/SourcesPage/routes';

export interface Props {
  form: FormInstance;
  initialValues: DestinationData;
}

const DestinationEditorConnectors = ({ form, initialValues }: Props) => {
  const service = ApplicationServices.get();

  const [sourcesError, sourcesData] = useLoader(async() => await service.storageService.get('sources', service.activeProject.id));
  const [APIKeysError, APIKeysData] = useLoader(async() => await service.storageService.get('api_keys', service.activeProject.id));

  const sourcesList = useMemo<ConnectedItem[]>(
    () => sourcesData?.sources
      ? sourcesData.sources?.map((source: SourceData) => {
        const proto = allSources.find(s => s.id === source.sourceType);

        return {
          itemKey: source.sourceId,
          id: source.sourceId,
          title: source.sourceId,
          icon: proto?.pic,
          link: generatePath(sourcesPageRoutes.editExact, { sourceId: source.sourceId }),
          description: proto?.displayName
        };
      })
      : [],
    [sourcesData?.sources]
  );

  const apiKeysList = useMemo<ConnectedItem[]>(
    () => APIKeysData?.keys
      ? APIKeysData.keys.map((key: APIKey) => ({
        itemKey: key.uid,
        title: key.uid,
        id: key.uid,
        link: '/api_keys'
      }))
      : [],
    [APIKeysData?.keys]
  );

  return (
    <>
      <Form form={form} name="connected-sources">
        <div className="mb-10">
          <h3>Choose sources</h3>
          <article className="mb-5">
            {DESTINATIONS_CONNECTED_SOURCES}
            {
              sourcesData?.sources?.length === 0 && <p>If you haven't added any connectors yet you can do it <Link to="/sources">here</Link>.</p>
            }
          </article>
          {
            sourcesError
              ? <CenteredError error={sourcesError} />
              : !sourcesData
                ? <CenteredSpin />
                : <ConnectedItems
                  form={form}
                  fieldName="_sources"
                  itemsList={sourcesList}
                  warningMessage={<p>Please, choose at least one source.</p>}
                  initialValues={initialValues?._sources}
                />
          }
        </div>

        <div>
          <h3>Choose API keys</h3>

          {
            APIKeysError
              ? <CenteredError error={APIKeysError} />
              : !APIKeysData
                ? <CenteredSpin />
                : <ConnectedItems
                  form={form}
                  fieldName="_onlyKeys"
                  itemsList={apiKeysList}
                  warningMessage={<p>Please, choose at least one API key.</p>}
                  initialValues={initialValues?._onlyKeys}
                />
          }
        </div>
      </Form>
    </>
  );
};

DestinationEditorConnectors.displayName = 'DestinationEditorConnectors';

export { DestinationEditorConnectors };
