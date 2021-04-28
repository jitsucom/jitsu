// @Libs
import React, { ReactNode, useCallback, useMemo } from 'react';
import { generatePath, Link, useHistory } from 'react-router-dom';
import { Button, Collapse, Form } from 'antd';
// @Hooks
import useLoader from '@hooks/useLoader';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Components
import { ConnectedItems } from '@organism/ConnectedItems';
import { ListItemDescription } from '@atom/ListItemDescription';
import { CenteredError, CenteredSpin, CodeInline } from '@./lib/components/components';
import { NavLink } from 'react-router-dom';

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
import Error from '../../../../../../../../calendso/pages/auth/error';
import Icon from '@ant-design/icons';
import { NameWithPicture } from '@organism/ConnectedItems/ConnectedItems';

export interface Props {
  form: FormInstance;
  initialValues: DestinationData;
}


const DestinationEditorConnectors = ({ form, initialValues }: Props) => {
  const history = useHistory();

  const service = ApplicationServices.get();

  const [sourcesError, sourcesData] = useLoader(async() => await service.storageService.get('sources', service.activeProject.id));
  const [apiKeysError, apiKeysData] = useLoader(async() => await service.storageService.get('api_keys', service.activeProject.id));

  const handleEditAction = useCallback((id: string) => () => history.push(generatePath(sourcesPageRoutes.editExact, { sourceId: id })), [history]);

  const sourcesList = useMemo<ConnectedItem[]>(
    () => sourcesData?.sources
      ?
      sourcesData.sources?.map((src: SourceData) => {
        const proto = allSources.find(s => s.id === src.sourceType);

        return {
          id: src.sourceId,
          title: <><NameWithPicture icon={proto?.pic}><b>{proto?.displayName}: </b> {sourcePageUtils.getTitle(src)}</NameWithPicture></>,
          description: null
        };
      })
      :
      [],
    [handleEditAction, sourcesData?.sources]
  );

  const apiKeysList = useMemo<ConnectedItem[]>(
    () => apiKeysData?.keys
      ?
      apiKeysData.keys.map((key: APIKey) => ({
        title: <code>{key.uid}</code>,
        id: key.uid,
        description: <div className="align-middle">Server secret: <code>{key.serverAuth}</code> / Client secret: <code>{key.jsAuth}</code></div>
      }))
      :
      [],
    [apiKeysData?.keys]
  );

  if (apiKeysError || sourcesError) {
    return <CenteredError error={apiKeysError || sourcesError}/>
  } else if (!sourcesData || !apiKeysData) {
    return <CenteredSpin/>
  }

  let activeKey;
  if (apiKeysList.length > 0 || sourcesData.sources.length === 0 && apiKeysList.length === 0) {
    activeKey = 'keys';
  } else {
    activeKey = 'connectors'
  }

  return (
    <>
      <Form form={form} name="connected-sources">
        <div className="text-xs italic text-secondaryText mb-5">{DESTINATIONS_CONNECTED_SOURCES}</div>
        <Collapse ghost defaultActiveKey={activeKey}>
          <Collapse.Panel header={<b>Linked API Keys (<NavLink to="/api_keys">edit API keys</NavLink>)</b>} key="keys">
            <div className="pl-6">
              <ConnectedItems
                form={form}
                fieldName="_onlyKeys"
                itemsList={apiKeysList}
                warningMessage={<p>Please, choose at least one API key.</p>}
                initialValues={initialValues?._onlyKeys}/>
            </div>
          </Collapse.Panel>
          <Collapse.Panel header={<b>Linked Connectors (<NavLink to="/api_keys">edit connectors</NavLink>)</b>} key="connectors">
            <div className="pl-6">
              {
                sourcesData && !sourcesData?.sources?.length &&
                <p className="text-sm text-secondaryText">You don't have any connectors you can link to the destination. You can add them <Link to="/sources">here</Link>.</p>
              }
              <ConnectedItems
                form={form}
                fieldName="_sources"
                itemsList={sourcesList}
                warningMessage={<p>Please, choose at least one source.</p>}
                initialValues={initialValues?._sources}
              />
            </div>
          </Collapse.Panel>
        </Collapse>
      </Form>
    </>
  );
};

DestinationEditorConnectors.displayName = 'DestinationEditorConnectors';

export { DestinationEditorConnectors };
