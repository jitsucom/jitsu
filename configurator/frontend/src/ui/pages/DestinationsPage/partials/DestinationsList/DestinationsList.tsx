// @Libs
import React, { useCallback, useEffect } from 'react';
import { generatePath, useHistory } from 'react-router-dom';
import { Button, Dropdown, message, Modal, Popover, Tooltip } from 'antd';
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
  CodeInline,
  CodeSnippet,
  handleError
} from '@./lib/components/components';
import { DropDownList } from '@molecule/DropDownList';
import { ListItem } from '@molecule/ListItem';
import { LabelWithTooltip } from '@atom/LabelWithTooltip';
import { EmptyList } from '@molecule/EmptyList';
// @Icons
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';
import ExclamationCircleOutlined from '@ant-design/icons/lib/icons/ExclamationCircleOutlined';
// @Styles
import styles from './DestinationsList.module.less';
// @Utils
import { copyToClipboard } from '@./lib/commons/utils';
// @Routes
import { destinationPageRoutes } from '@page/DestinationsPage/DestinationsPage.routes';
// @Types
import { CommonDestinationPageProps } from '@page/DestinationsPage/DestinationsPage';
import { Destination } from '@catalog/destinations/types';
import { withHome } from '@molecule/Breadcrumbs/Breadcrumbs.types';

const DestinationsList = ({ destinations, updateDestinations, setBreadcrumbs }: CommonDestinationPageProps) => {
  const history = useHistory();

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

  const getDescription = useCallback((reference: Destination, dst: DestinationData) => {
    const { title, connectCmd } = reference.ui;

    const commandLineConnect = typeof connectCmd === 'function' ? connectCmd(dst) : undefined;
    const displayURL = typeof title === 'function' ? title(dst) : undefined;

    if (!commandLineConnect) {
      return displayURL;
    }

    const codeSnippet = commandLineConnect.indexOf('\n') < 0
      ? <>
        <div>
          <CodeInline>{commandLineConnect}</CodeInline>
        </div>
        <Align horizontal="right">
          <ActionLink
            onClick={() => {
              copyToClipboard(commandLineConnect);
              message.info('Command copied to clipboard', 2);
            }}>
            Copy command to clipboard
          </ActionLink>
        </Align>
      </>
      : <CodeSnippet className="destinations-list-multiline-code" language="bash">
        {commandLineConnect}
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
      <span className={styles.description}>{displayURL}</span>
    </Popover>;
  }, []);

  const getMode = useCallback((mode: string) => mode
    ? <span className={styles.mode}>mode: {mode}</span>
    : undefined, []);

  const update = useCallback((id: string) => async() => {
    const appServices = ApplicationServices.get();

    const newDestinations = destinations.filter(dest => dest._id !== id);

    try {
      await appServices.storageService.save('destinations', { destinations: newDestinations }, appServices.activeProject.id);

      updateDestinations({ destinations: newDestinations });
    } catch (errors) {
      handleError(errors, 'Unable to delete destination at this moment, please try later.')
    }
  }, [destinations, updateDestinations]);

  const handleDeleteAction = useCallback((id: string) => () => {
    Modal.confirm({
      title: 'Please confirm deletion of destination',
      icon: <ExclamationCircleOutlined/>,
      content: 'Are you sure you want to delete ' + id + ' destination?',
      okText: 'Delete',
      cancelText: 'Cancel',
      onOk: update(id)
    });
  }, [update]);

  const handleEditAction = useCallback((id: string) => () => history.push(generatePath(destinationPageRoutes.editDestination, { id })), [history]);

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
      list={
        <DropDownList
          hideFilter
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
            hideFilter
            getPath={getGeneratedPath}
            list={destinationsReferenceList}
            filterPlaceholder="Filter by destination name"
          />
        }
      >
        <Button type="primary" icon={<PlusOutlined />}>Add destination</Button>
      </Dropdown>
    </div>

    <ul className={styles.list}>
      {
        destinations.map((dst: DestinationData) => {
          const reference = destinationsReferenceMap[dst._type];

          return <ListItem
            additional={getMode(dst._mode)}
            description={getDescription(reference, dst)}
            icon={reference?.ui?.icon}
            title={getTitle(dst)}
            id={dst._id}
            key={dst._id}
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
