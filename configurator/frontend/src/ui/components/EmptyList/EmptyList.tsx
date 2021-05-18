// @Libs
import React, { memo, ReactElement, ReactNode, useState } from 'react';
import { Button, Dropdown, Modal } from 'antd';
import { NavLink, useHistory } from 'react-router-dom';
// @Styles
import styles from './EmptyList.module.less';
// @Icons
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';
import CheckOutlined from '@ant-design/icons/lib/icons/CheckOutlined';
import { useServices } from '@hooks/useServices';
import { handleError } from '@./lib/components/components';
import ApiKeyHelper from '@service/ApiKeyHelper';
import ExclamationCircleOutlined from '@ant-design/icons/lib/icons/ExclamationCircleOutlined';
import { randomId } from '@util/numbers';
import { reloadPage } from '@./lib/commons/utils';

export interface Props {
  title: ReactNode;
  list?: ReactElement;
  unit: string;
}

const EmptyListComponent = ({ title, list, unit }: Props) => {
  const services = useServices();
  const [creating, setCreating] = useState(false);
  const router = useHistory();
  return <div className={styles.empty}>
    <h3 className="text-2xl">{title}</h3>
    <div className="flex flex-row justify-center items center">
      <div className="h-32 w-80">
        <Dropdown placement="bottomCenter" trigger={['click']} overlay={list}>
          <Button type="primary" className="w-80" size="large" icon={<PlusOutlined />}>{`Add ${unit}`}</Button>
        </Dropdown>
      </div>
      {services.features.createDemoDatabase && <>
        <div className="h-32  px-3 pt-2">
        or
        </div>
        <div className="h-32  w-80">
          <Button loading={creating} type="primary" className="w-80" size="large" icon={<CheckOutlined />}
            onClick={async() => {
              setCreating(true);
              try {
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

              } catch (e) {
                handleError(e);
              } finally {
                setCreating(false);
              }
            }}
          >Create a free database</Button>
          <div className="text-xs text-secondaryText text-center mt-2">Create a free PostgresSQL database with 10,000 row limit</div>
        </div>
      </>}
    </div>
  </div>
};

EmptyListComponent.displayName = 'EmptyList';

export const EmptyList = memo(EmptyListComponent);
