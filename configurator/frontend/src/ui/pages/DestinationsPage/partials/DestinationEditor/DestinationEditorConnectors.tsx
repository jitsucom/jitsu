// @Libs
import React, { useCallback, useMemo } from 'react';
import { generatePath, Link, useHistory } from 'react-router-dom';
import { Form } from 'antd';
// @Hooks
import useLoader from '@hooks/useLoader';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Components
import { ConnectedItems } from '@organism/ConnectedItems';
import { ListItemDescription } from '@atom/ListItemDescription';
import { CenteredError, CenteredSpin } from '@./lib/components/components';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { ConnectedItem } from '@organism/ConnectedItems';
// @Catalog sources
import { allSources } from '@catalog/sources/lib';
// @Constants
import {
  DESTINATIONS_CONNECTED_API_KEYS,
  DESTINATIONS_CONNECTED_SOURCES
} from '@./embeddedDocs/destinationsConnectedItems';
// @Routes
import { sourcesPageRoutes } from '@page/SourcesPage/routes';
import { sourcePageUtils } from '@page/SourcesPage/SourcePage.utils';

export interface Props {
  form: FormInstance;
  initialValues: DestinationData;
}

const DestinationEditorConnectors = ({ form, initialValues }: Props) => {
  const history = useHistory();

  const service = ApplicationServices.get();

  const [sourcesError, sourcesData] = useLoader(async() => await service.storageService.get('sources', service.activeProject.id));
  const [APIKeysError, APIKeysData] = useLoader(async() => await service.storageService.get('api_keys', service.activeProject.id));

  const handleEditAction = useCallback((id: string) => () => history.push(generatePath(sourcesPageRoutes.editExact, { sourceId: id })), [history]);

  const sourcesList = useMemo<ConnectedItem[]>(
    () => sourcesData?.sources
      ? sourcesData.sources?.map((src: SourceData) => {
        const proto = allSources.find(s => s.id === src.sourceType);

        return {
          itemKey: src.sourceId,
          id: src.sourceId,
          title: sourcePageUtils.getTitle(src),
          icon: proto?.pic,
          description: proto?.displayName,
          actions: [{ key: 'edit', method: handleEditAction, title: 'Edit' }]
        };
      })
      : [],
    [handleEditAction, sourcesData?.sources]
  );

  const apiKeysList = useMemo<ConnectedItem[]>(
    () => APIKeysData?.keys
      ? APIKeysData.keys.map((key: APIKey) => ({
        itemKey: key.uid,
        title: key.uid,
        id: key.uid,
        additional: key.origins?.length ? <ListItemDescription render={<>Origins: {key.origins.join(', ')}</>} /> : undefined,
        description: <ListItemDescription render={<>Server secret: {key.serverAuth}<br />Client secret: {key.jsAuth}</>} />
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
              sourcesData && !sourcesData?.sources?.length && <p>If you haven't added any connectors yet you can do it <Link to="/sources">here</Link>.</p>
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
          {DESTINATIONS_CONNECTED_API_KEYS}
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
