// @Libs
import { memo, ReactElement, ReactNode, useCallback } from 'react';
import { Modal } from 'antd';
import { useHistory } from 'react-router-dom';
// @Components
import { EmptyListView } from './EmptyListView';
import { reloadPage } from '@./lib/commons/utils';
// @Commons
import { createFreeDatabase } from '@./lib/commons/createFreeDatabase';

export interface Props {
  title: ReactNode;
  list?: ReactElement;
  unit: string;
}

const EmptyListComponent = ({ title, list, unit }: Props) => {
  const router = useHistory();

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
      handleCreateFreeDatabase={handleCreateFreeDatabase}
    />
  );
};

EmptyListComponent.displayName = 'EmptyList';

export const EmptyList = memo(EmptyListComponent);
