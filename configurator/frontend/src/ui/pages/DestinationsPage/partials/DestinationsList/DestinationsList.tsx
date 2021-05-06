// @Libs
import React, { useCallback, useEffect, useMemo } from 'react';
import { generatePath, useHistory } from 'react-router-dom';
import { Button, Dropdown, Modal } from 'antd';
// @Services
import ApplicationServices from '@service/ApplicationServices';
import { destinationsReferenceList, destinationsReferenceMap } from '@page/DestinationsPage/commons';
// @Components
import { handleError } from '@./lib/components/components';
import { DropDownList } from '@molecule/DropDownList';
import { ListItem } from '@molecule/ListItem';
import { EmptyList } from '@molecule/EmptyList';
// @Icons
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';
import ExclamationCircleOutlined from '@ant-design/icons/lib/icons/ExclamationCircleOutlined';
// @Styles
import styles from './DestinationsList.module.less';
// @Utils
import { destinationsUtils } from '@page/DestinationsPage/DestinationsPage.utils';
// @Routes
import { destinationPageRoutes } from '@page/DestinationsPage/DestinationsPage.routes';
// @Types
import { CommonDestinationPageProps } from '@page/DestinationsPage';
import { Destination } from '@catalog/destinations/types';
import { withHome } from '@molecule/Breadcrumbs/Breadcrumbs.types';
import { destinationEditorUtils } from '@page/DestinationsPage/partials/DestinationEditor/DestinationEditor.utils';

import CodeOutlined from '@ant-design/icons/lib/icons/CodeOutlined';
import DeleteOutlined from '@ant-design/icons/lib/icons/DeleteOutlined';
import EditOutlined from '@ant-design/icons/lib/icons/EditOutlined';

const DestinationsList = ({ destinations, updateDestinations, setBreadcrumbs, sources, updateSources  }: CommonDestinationPageProps) => {
  const history = useHistory();

  const update = useCallback((id: string) => async() => {
    const appServices = ApplicationServices.get();

    const currentDestination = destinations.find(dest => dest._id === id);

    const newDestinations = destinations.filter(dest => dest._id !== id);

    try {
      const updatesSources = destinationEditorUtils.updateSources(sources, currentDestination, appServices.activeProject.id);
      updateSources({ sources: updatesSources });

      await appServices.storageService.save('destinations', { destinations: newDestinations }, appServices.activeProject.id);

      updateDestinations({ destinations: newDestinations });
    } catch (errors) {
      handleError(errors, 'Unable to delete destination at this moment, please try later.')
    }
  }, [destinations, updateDestinations, sources, updateSources]);

  const dropDownList = useMemo(() => <DropDownList
    hideFilter
    list={destinationsReferenceList.map((dst: Destination) => ({
      title: dst.displayName,
      id: dst.id,
      icon: dst.ui.icon,
      link: generatePath(destinationPageRoutes.newDestination, { type: dst.id })
    }))}
    filterPlaceholder="Filter by destination name or id"
  />, []);

  useEffect(() => {
    setBreadcrumbs(withHome({
      elements: [
        { title: 'Destinations', link: destinationPageRoutes.root },
        {
          title: 'Destinations List'
        }
      ]
    }));
  }, [setBreadcrumbs])

  if (destinations.length === 0) {
    return <EmptyList
      list={dropDownList}
      title="Destinations list is still empty"
      unit="destination"
    />;
  }

  return <>
    <div className="mb-5">
      <Dropdown
        trigger={['click']}
        overlay={dropDownList}
      >
        <Button type="primary" icon={<PlusOutlined />}>Add destination</Button>
      </Dropdown>
    </div>

    <ul className={styles.list}>
      {
        destinations.map((dst: DestinationData) => {
          const reference = destinationsReferenceMap[dst._type];

          return <ListItem
            additional={destinationsUtils.getMode(dst._formData?.mode)}
            description={destinationsUtils.getDescription(reference, dst)}
            title={destinationsUtils.getTitle(dst)}
            icon={reference?.ui?.icon}
            id={dst._id}
            key={dst._id}
            actions={[
              { onClick: () => history.push(generatePath(destinationPageRoutes.editDestination, { id: dst._id })), title: 'Edit', icon: <EditOutlined /> },
              { onClick: () => {
                Modal.confirm({
                  title: 'Please confirm deletion of destination',
                  icon: <ExclamationCircleOutlined/>,
                  content: 'Are you sure you want to delete ' + dst._id + ' destination?',
                  okText: 'Delete',
                  cancelText: 'Cancel',
                  onOk: update(dst._id)
                });
              }, title: 'Delete', icon: <DeleteOutlined /> }
            ]}
          />
        })
      }
    </ul>
  </>
};

export { DestinationsList };
