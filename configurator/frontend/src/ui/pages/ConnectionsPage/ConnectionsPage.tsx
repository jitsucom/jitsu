// @Libs
import { Badge, Button, Dropdown, Typography } from 'antd';
import React, { useCallback, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import LeaderLine from 'leader-line-new';
// @Store
import { apiKeysStore } from 'stores/apiKeys';
import { sourcesStore } from 'stores/sources';
import { destinationsStore } from 'stores/destinations';
// @Components
import { EntityCard } from 'lib/components/EntityCard/EntityCard';
import { EntityIcon } from 'lib/components/EntityIcon/EntityIcon';
import { DropDownList } from 'ui/components/DropDownList/DropDownList';
// @Icons
import { PlusOutlined } from '@ant-design/icons';
// @Utils
import { generatePath } from 'react-router-dom';
// @Reference
import { destinationsReferenceList } from 'catalog/destinations/lib';
import { destinationPageRoutes } from '../DestinationsPage/DestinationsPage.routes';
// @Styles
import styles from './ConnectionsPage.module.less';

const CONNECTION_LINE_SIZE = 3;
const CONNECTION_LINE_COLOR = '#415969';
const CONNECTION_LINE_HIGHLIGHTED_COLOR = '#878afc';

const connectionLines: { [key: string]: LeaderLine } = {};

const ConnectionsPageComponent: React.FC = () => {
  const drawLines = () => {
    destinationsStore.destinations.forEach(
      ({ _uid, _onlyKeys = [], _sources = [] }) => {
        [..._onlyKeys, ..._sources].forEach((sourceId) => {
          const start = document.getElementById(sourceId);
          const end = document.getElementById(_uid);
          if (start && end)
            connectionLines[`${sourceId}-${_uid}`] = new LeaderLine(
              start,
              end,
              {
                endPlug: 'behind',
                color: CONNECTION_LINE_COLOR,
                size: CONNECTION_LINE_SIZE
              }
            );
        });
      }
    );
  };

  const cleanupObsoleteLines = () => {
    // Object.keys(connectionLines).forEach((key) => {
    //   if (!connectionLines[key]) delete connectionLines[key];
    // });
  };

  const eraseLines = () => {
    Object.entries(connectionLines).forEach(([key, line]) => {
      line.remove();
      delete connectionLines[key];
    });
  };

  const handleCardMouseEnter = useCallback((sourceId: string) => {
    Object.keys(connectionLines).forEach((key) => {
      if (key.startsWith(sourceId) || key.endsWith(sourceId)) {
        connectionLines[key]?.setOptions({
          color: CONNECTION_LINE_HIGHLIGHTED_COLOR
        });
      } else {
        connectionLines[key]?.setOptions({ size: 0.01 });
      }
    });
  }, []);

  const handleCardMouseLeave = useCallback(() => {
    Object.keys(connectionLines).forEach((key) => {
      connectionLines[key]?.setOptions({ color: CONNECTION_LINE_COLOR });
      connectionLines[key]?.setOptions({ size: CONNECTION_LINE_SIZE });
    });
  }, []);

  useEffect(() => {
    cleanupObsoleteLines();
    drawLines();
    return () => {
      eraseLines();
    };
  }, []);

  return (
    <div className="flex justify-center w-full h-full">
      <div className="flex items-stretch w-full h-full max-w-3xl">
        <Column
          className="max-w-xs w-full"
          header={
            <div className="flex w-full mb-3">
              <h3 className="block flex-auto text-3xl mb-0">{'Sources'}</h3>
              <Dropdown
                trigger={['click']}
                overlay={<AddSourceDropdownOverlay />}
                className="flex-initial"
                placement="bottomRight"
              >
                <Button type="ghost" size="large" icon={<PlusOutlined />}>
                  Add
                </Button>
              </Dropdown>
            </div>
          }
        >
          {apiKeysStore.apiKeys.map(({ uid }) => {
            return (
              <CardContainer id={uid}>
                <EntityCard
                  name={<ApiKeyCardTitle title={`API Key ${uid}`} />}
                  message={<EntityMessage connectionTestOk={true} />}
                  link="/api_keys"
                  icon={
                    <IconWrapper sizePx={14}>
                      <EntityIcon entityType="api_key" />
                    </IconWrapper>
                  }
                  onMouseEnter={() => handleCardMouseEnter(uid)}
                  onMouseLeave={handleCardMouseLeave}
                />
              </CardContainer>
            );
          })}
          {sourcesStore.sources.map(({ sourceId, sourceType, connected }) => {
            return (
              <CardContainer id={sourceId}>
                <EntityCard
                  name={sourceId}
                  message={<EntityMessage connectionTestOk={connected} />}
                  link={`/sources/edit/${sourceId}`}
                  icon={
                    <IconWrapper sizePx={14}>
                      <EntityIcon
                        entityType="source"
                        entitySubType={sourceType}
                      />
                    </IconWrapper>
                  }
                  onMouseEnter={() => handleCardMouseEnter(sourceId)}
                  onMouseLeave={handleCardMouseLeave}
                />
              </CardContainer>
            );
          })}
        </Column>

        <Column />

        <Column
          className="max-w-xs w-full"
          header={
            <div className="flex w-full mb-3">
              <h3 className="block flex-auto text-3xl mb-0">
                {'Destinations'}
              </h3>
              <Dropdown
                trigger={['click']}
                overlay={
                  <DropDownList
                    hideFilter
                    list={destinationsReferenceList.map((dst) => ({
                      title: dst.displayName,
                      id: dst.id,
                      icon: dst.ui.icon,
                      link: generatePath(destinationPageRoutes.newExact, {
                        type: dst.id
                      })
                    }))}
                  />
                }
                className="flex-initial"
              >
                <Button type="ghost" size="large" icon={<PlusOutlined />}>
                  Add
                </Button>
              </Dropdown>
            </div>
          }
        >
          {destinationsStore.destinations.map(
            ({ _id, _uid, _type, _connectionTestOk }) => {
              return (
                <CardContainer id={_uid}>
                  <EntityCard
                    name={_id}
                    message={
                      <EntityMessage connectionTestOk={_connectionTestOk} />
                    }
                    link={`/destinations/edit/${_id}`}
                    icon={
                      <IconWrapper sizePx={14}>
                        <EntityIcon
                          entityType="destination"
                          entitySubType={_type}
                        />
                      </IconWrapper>
                    }
                    onMouseEnter={() => handleCardMouseEnter(_uid)}
                    onMouseLeave={handleCardMouseLeave}
                  />
                </CardContainer>
              );
            }
          )}
        </Column>
      </div>
    </div>
  );
};

const ConnectionsPage = observer(ConnectionsPageComponent);
ConnectionsPage.displayName = 'ConnectionsPage';

export default ConnectionsPage;

const AddSourceDropdownOverlay: React.FC = () => {
  return (
    <DropDownList
      hideFilter
      list={[
        {
          id: 'api_key',
          title: 'Add JS Events API Key',
          link: '/api_keys'
        },
        {
          id: 'connectors',
          title: 'Add Connector Source',
          link: '/sources/add'
        }
      ]}
    />
  );
};

const EntityMessage: React.FC<{ connectionTestOk: boolean }> = ({
  connectionTestOk
}) => {
  return (
    <div>
      <Badge
        size="default"
        status={connectionTestOk ? 'processing' : 'error'}
        text={
          connectionTestOk ? (
            <span className={styles.processing}>{'Active'}</span>
          ) : (
            <span className={styles.error}>{'Connection test failed'}</span>
          )
        }
      />
    </div>
  );
};

const IconWrapper: React.FC<{ sizePx: number }> = ({ children, sizePx }) => {
  return (
    <div
      className={`flex justify-center items-center h-${sizePx} w-${sizePx} m-3`}
    >
      {children}
    </div>
  );
};

const Column: React.FC<{ header?: React.ReactNode; className?: string }> = ({
  header,
  className,
  children
}) => {
  return (
    <div className={`flex flex-col flex-auto ${className}`}>
      {header && <div>{header}</div>}
      <div className={`flex flex-col`}>{children}</div>
    </div>
  );
};

const CardContainer: React.FC<{ id: string }> = ({ id, children }) => {
  return (
    <div key={id} className={`my-2 w-full`} id={id}>
      {children}
    </div>
  );
};

const ELLIPSIS_SUFFIX_LENGTH = 4;

const ApiKeyCardTitle: React.FC<{ title: string }> = ({ title }) => {
  const parsedTitle = {
    start: title.slice(0, title.length - ELLIPSIS_SUFFIX_LENGTH),
    end: title.slice(-ELLIPSIS_SUFFIX_LENGTH)
  };

  return (
    <Typography.Text
      className="w-full"
      ellipsis={{
        suffix: parsedTitle.end
      }}
    >
      {parsedTitle.start}
    </Typography.Text>
  );
};
