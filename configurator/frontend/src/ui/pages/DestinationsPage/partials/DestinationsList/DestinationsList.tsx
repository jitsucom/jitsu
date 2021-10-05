// @Libs
import { useCallback, useEffect, useMemo, useState } from 'react';
import { generatePath, useHistory } from 'react-router-dom';
import { Button, Dropdown, Modal } from 'antd';
import { observer } from 'mobx-react-lite';
// @Services
import {
  destinationsReferenceList,
  destinationsReferenceMap
} from 'catalog/destinations/lib';
// @Store
import { destinationsStore } from 'stores/destinations';
// @Components
import { handleError } from 'lib/components/components';
import { DropDownList } from 'ui/components/DropDownList/DropDownList';
import { ListItem } from 'ui/components/ListItem/ListItem';
import { EmptyList } from 'ui/components/EmptyList/EmptyList';
// @Icons
import {
  PlusOutlined,
  ExclamationCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  AreaChartOutlined
} from '@ant-design/icons';
// @Styles
import styles from './DestinationsList.module.less';
// @Utils
import { destinationsUtils } from 'ui/pages/DestinationsPage/DestinationsPage.utils';
import { withHome } from 'ui/components/Breadcrumbs/Breadcrumbs';
// @Routes
import { destinationPageRoutes } from 'ui/pages/DestinationsPage/DestinationsPage.routes';
// @Types
import { CommonDestinationPageProps } from 'ui/pages/DestinationsPage/DestinationsPage';
import { Destination } from 'catalog/destinations/types';

const DestinationsListComponent = ({
  setBreadcrumbs
}: CommonDestinationPageProps) => {
  const history = useHistory();

  const [hideSensitiveInfo] = useState(false);

  const deleteDestination = useCallback(
    (id: string) => async () => {
      const destinationToDelete = destinationsStore.getDestinationById(id);

      try {
        destinationsStore.deleteDestination(destinationToDelete);
      } catch (errors) {
        handleError(
          errors,
          'Unable to delete destination at this moment, please try later.'
        );
      }
    },
    []
  );

  const dropDownList = useMemo(
    () => (
      <DropDownList
        hideFilter
        list={destinationsReferenceList
          .filter((v) => !v.hidden)
          .map((dst: Destination) => ({
            title: dst.displayName,
            id: dst.id,
            icon: dst.ui.icon,
            link: generatePath(destinationPageRoutes.newExact, {
              type: dst.id
            })
          }))}
      />
    ),
    []
  );

  useEffect(() => {
    setBreadcrumbs(
      withHome({
        elements: [
          { title: 'Destinations', link: destinationPageRoutes.root },
          {
            title: 'Destinations List'
          }
        ]
      })
    );
  }, [setBreadcrumbs]);

  if (destinationsStore.destinations.length === 0) {
    return (
      <EmptyList
        list={dropDownList}
        title="Destinations list is still empty"
        unit="destination"
      />
    );
  }

  return (
    <>
      <div className="mb-5">
        <Dropdown trigger={['click']} overlay={dropDownList}>
          <Button type="primary" icon={<PlusOutlined />}>
            Add destination
          </Button>
        </Dropdown>
      </div>

      <ul className={styles.list}>
        {destinationsStore.destinations.map((dst: DestinationData) => {
          const reference = destinationsReferenceMap[dst._type];
          if (!reference) {
            throw new Error(
              `Unknown destination type ${
                dst._type
              }. Supported types: ${Object.keys(destinationsReferenceMap)}`
            );
          }

          return (
            <ListItem
              additional={destinationsUtils.getMode(dst._formData?.mode)}
              description={destinationsUtils.getDescription(
                reference,
                dst,
                hideSensitiveInfo
              )}
              title={destinationsUtils.getTitle(dst)}
              icon={reference?.ui?.icon}
              id={dst._id}
              key={dst._id}
              actions={[
                {
                  onClick: () =>
                    history.push(
                      generatePath(destinationPageRoutes.statisticsExact, {
                        id: dst._id
                      })
                    ),
                  title: 'Statistics',
                  icon: <AreaChartOutlined />
                },
                {
                  onClick: () =>
                    history.push(
                      generatePath(destinationPageRoutes.editExact, {
                        id: dst._id
                      })
                    ),
                  title: 'Edit',
                  icon: <EditOutlined />
                },
                {
                  onClick: () => {
                    Modal.confirm({
                      title: 'Please confirm deletion of destination',
                      icon: <ExclamationCircleOutlined />,
                      content:
                        'Are you sure you want to delete ' +
                        dst._id +
                        ' destination?',
                      okText: 'Delete',
                      cancelText: 'Cancel',
                      onOk: deleteDestination(dst._id)
                    });
                  },
                  title: 'Delete',
                  icon: <DeleteOutlined />
                }
              ]}
            />
          );
        })}
      </ul>
    </>
  );
};

export const DestinationsList = observer(DestinationsListComponent);
