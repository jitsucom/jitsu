// @Libs
import { memo, ReactElement, ReactNode, useCallback, useMemo } from 'react';
import { Modal } from 'antd';
import { useHistory } from 'react-router-dom';
// @Components
import { EmptyListView } from './EmptyListView';
import { reloadPage } from '@./lib/commons/utils';
// @Commons
import { createFreeDatabase } from '@./lib/commons/createFreeDatabase';
import ApplicationServices from '@./lib/services/ApplicationServices';
import { useServices } from '@./hooks/useServices';

export interface Props {
  title: ReactNode;
  list?: ReactElement;
  unit: string;
}

const services = ApplicationServices.get();

const EmptyListComponent = ({ title, list, unit }: Props) => {
  const router = useHistory();
  const services = useServices();

  const needShowCreateDemoDatabase = useMemo<boolean>(() => services.features.createDemoDatabase, [
    services.features.createDemoDatabase
  ]);

  const handleCreateFreeDatabase = useCallback<() => Promise<void>>(async() => {
    await createFreeDatabase();
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
  }, [router]);

  return (
    <EmptyListView
      title={title}
      list={list}
      unit={unit}
      hideFreeDatabaseSeparateButton={!needShowCreateDemoDatabase}
      handleCreateFreeDatabase={handleCreateFreeDatabase}
    />
  );
};

EmptyListComponent.displayName = 'EmptyList';

export const EmptyList = memo(EmptyListComponent);
