// @Libs
import React, { useCallback } from 'react';
import { generatePath, useHistory } from 'react-router-dom';
import { Button, Dropdown, List, message, Modal, Popover, Tooltip } from 'antd';
// @Hooks
import useLoader from '@hooks/useLoader';
// @Services
import ApplicationServices from '@service/ApplicationServices';
import {
  destinationsReferenceList,
  destinationsReferenceMap,
  getGeneratedPath
} from '@page/DestinationsPage/commons';
// @Components
import {
  ActionLink,
  Align,
  CenteredError,
  CenteredSpin,
  CodeInline,
  CodeSnippet,
  handleError
} from '@./lib/components/components';
import { EmptyList } from '@molecule/EmptyList';
import { DropDownList } from '@molecule/DropDownList';
import { ListItem } from '@molecule/ListItem';
import { LabelWithTooltip } from '@atom/LabelWithTooltip';
// @Icons
import DatabaseOutlined from '@ant-design/icons/lib/icons/DatabaseOutlined';
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';
import ExclamationCircleOutlined from '@ant-design/icons/lib/icons/ExclamationCircleOutlined';
// @Styles
import styles from './DestinationsList.module.less';
// @Utils
import { copyToClipboard } from '@./lib/commons/utils';
// @Routes
import { destinationPageRoutes } from '@page/DestinationsPage/DestinationsPage.routes';

export function getIconSrc(destinationType: string): string {
  try {
    const icon = require('/src/icons/destinations/' + destinationType + '.svg');
    return icon.default;
  } catch (e) {
    console.log('Icon for ' + destinationType + ' is not found');
    return null;
  }
}

export function getIcon(destinationType: string): any {
  let src = getIconSrc(destinationType);
  return src
    ? <img src={src} className="destination-type-icon" alt="[destination]"/>
    : <DatabaseOutlined/>;
}

const DestinationsList = () => {
  const history = useHistory();

  const destinations = [];
  const error = false;

  const getTitle = useCallback((dst: DestinationData) => {
    const configTitle = dst._connectionTestOk
      ? <>{dst._id}</> :
      <Tooltip
        trigger={['click', 'hover']}
        title={
          <>
            Last connection test failed with <b><i>'{dst._connectionErrorMessage}'</i></b>. Destination might be not
            accepting data. Please, go to editor and fix the connection settings
          </>
        }>
        <strong className={styles.errorName}>
          <b>!</b> {dst._id}
        </strong>
      </Tooltip>;

    return dst._comment
      ? <LabelWithTooltip documentation={dst._comment} render={configTitle} />
      : configTitle;
  }, []);

  const getDescription = useCallback((dst: DestinationData) => {
    const description = dst._description ?? {} as any;

    if (!description.commandLineConnect) {
      return description.displayURL;
    }

    const codeSnippet = description.commandLineConnect.indexOf('\n') < 0
      ? <>
        <div>
          <CodeInline>{description.commandLineConnect}</CodeInline>
        </div>
        <Align horizontal="right">
          <ActionLink
            onClick={() => {
              copyToClipboard(description.commandLineConnect);
              message.info('Command copied to clipboard', 2);
            }}>
            Copy command to clipboard
          </ActionLink>
        </Align>
      </>
      : <CodeSnippet className="destinations-list-multiline-code" language="bash">
        {description.commandLineConnect}
      </CodeSnippet>;

    return <Popover
      placement="topLeft"
      content={
        <>
          <h4><b>Use following command to connect to DB and run a test query:</b></h4>
          {codeSnippet}
        </>
      }
      trigger="click">
      <span className={styles.description}>{description.displayURL}</span>
    </Popover>;
  }, []);

  const getMode = useCallback((mode: string) => mode
    ? <span className={styles.mode}>mode: {mode}</span>
    : undefined, []);

  const saveDestinations = useCallback(async(id: string) => {
    const appServices = ApplicationServices.get();

    const newDestinations = destinations.filter(dest => dest.id !== id);

    try {
      await appServices.storageService.save('destinations', { destinations: newDestinations }, appServices.activeProject.id);

      // updateDestinations(newDestinations);
    } catch (errors) {
      handleError(errors, 'Unable to delete destination at this moment, please try later.')
    }
  }, [destinations]);

  const handleDeleteAction = useCallback((id: string) => () => {
    Modal.confirm({
      title: 'Please confirm deletion of destination',
      icon: <ExclamationCircleOutlined/>,
      content: 'Are you sure you want to delete ' + id + ' destination?',
      okText: 'Delete',
      cancelText: 'Cancel',
      onOk: () => {
        saveDestinations(id);
      }
    });
  }, [saveDestinations]);

  const handleEditAction = useCallback((id: string) => () => history.push(generatePath(destinationPageRoutes.editDestination, { id })), [history]);

  if (error) {
    return <CenteredError error={error} />;
  } else if (!destinations) {
    return <CenteredSpin />;
  } else if (destinations.length === 0) {
    return <EmptyList
      list={
        <DropDownList
          getPath={getGeneratedPath}
          list={destinationsReferenceList}
          filterPlaceholder="Filter by destination name"
        />
      }
      title="Destinations list is still empty"
      unit="destination"
    />;
  }

  return <>
    <div className="mb-5">
      <Dropdown
        trigger={['click']}
        overlay={
          <DropDownList
            getPath={getGeneratedPath}
            list={destinationsReferenceList}
            filterPlaceholder="Filter by destination name"
          />
        }
      >
        <Button type="primary" icon={<PlusOutlined />}>Add source</Button>
      </Dropdown>
    </div>

    <ul className={styles.list}>
      {
        destinations.map((dst: DestinationData) => {
          const reference = destinationsReferenceMap[dst.type];

          return <ListItem
            additional={getMode(dst.mode)}
            description={getDescription(dst)}
            icon={reference?.ui?.icon}
            title={getTitle(dst)}
            id={dst.id}
            key={dst.id}
            actions={[
              { key: 'edit', method: handleEditAction, title: 'Edit' },
              { key: 'delete', method: handleDeleteAction, title: 'Delete' }
            ]}
          />
        })
      }
    </ul>
  </>
};

export { DestinationsList };
