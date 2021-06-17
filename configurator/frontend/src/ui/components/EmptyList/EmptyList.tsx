// @Libs
import { memo, ReactElement, ReactNode, useCallback } from 'react';
import { Modal } from 'antd';
import { useHistory } from 'react-router-dom';
// @Components
import { EmptyListView } from './EmptyListView';
// @Services
import { useServices } from '@hooks/useServices';
// @Utils
import ApiKeyHelper from '@service/ApiKeyHelper';
import { randomId } from '@util/numbers';
import { reloadPage } from '@./lib/commons/utils';

export interface Props {
  title: ReactNode;
  list?: ReactElement;
  unit: string;
}

const EmptyListComponent = ({ title, list, unit }: Props) => {
  const services = useServices();
  const router = useHistory();

  const handleCreateFreeDatabase = useCallback<() => Promise<void>>(async() => {
    const { destinations } = await services.initializeDefaultDestination();
    services.analyticsService.track('create_database');
    let helper = new ApiKeyHelper(services, { destinations });
    await helper.init();
    if (helper.keys.length === 0) {
      const newKey: APIKey = {
        uid: `${services.activeProject.id}.${randomId(5)}`,
        serverAuth: `s2s.${services.activeProject.id}.${randomId(5)}`,
        jsAuth: `js.${services.activeProject.id}.${randomId(5)}`,
        origins: []
      };
      await services.storageService.save('api_keys', { keys: [newKey] }, services.activeProject.id);
      helper = new ApiKeyHelper(services, { destinations, keys: [newKey] })
    }
    if (!helper.hasLinks()) {
      await helper.link();
    }
    const modal = Modal.info({
      title: 'New destination has been created',
      content: <>
        We have created a Postgres database for you. Also we made sure that <a onClick={() => {
          modal.destroy();
          router.push('/api_keys');
        }}>API key</a> has been created and linked to current destination.
        <br />
        Read more on how to send data to Jitsu with <a href="https://jitsu.com/docs/sending-data/js-sdk">JavaScript SDK</a> or <a href="https://jitsu.com/docs/sending-data/api">HTTP API</a>
      </>,
      onOk: () => reloadPage()
    });
  }, [
    services,
    router,
    services.activeProject.id
  ]);

  return (
    <EmptyListView
      title={title}
      list={list}
      unit={unit}
      showFreeDatabaseSeparateButton={true}
      handleCreateFreeDatabase={handleCreateFreeDatabase}
    />
  );
};

EmptyListComponent.displayName = 'EmptyList';

export const EmptyList = memo(EmptyListComponent);
