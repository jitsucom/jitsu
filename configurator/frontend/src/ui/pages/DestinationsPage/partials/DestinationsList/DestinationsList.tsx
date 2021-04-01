/* eslint-disable */
import * as React from 'react';
import { ReactNode, useState } from 'react';
import { DestinationConfig, destinationConfigTypes, destinationsByTypeId } from '@./lib/services/destinations';
import { Avatar, Button, Dropdown, Form, List, Menu, message, Modal, Popover, Tooltip } from 'antd';
import DatabaseOutlined from '@ant-design/icons/lib/icons/DatabaseOutlined';
import DeleteOutlined from '@ant-design/icons/lib/icons/DeleteOutlined';
import EditOutlined from '@ant-design/icons/lib/icons/EditOutlined';
import ExclamationCircleOutlined from '@ant-design/icons/lib/icons/ExclamationCircleOutlined';
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';
import '../../DestinationsPage.less';

import {
  ActionLink,
  Align, CenteredError, CenteredSpin,
  CodeInline,
  CodeSnippet,
  handleError,
  LabelWithTooltip,
  LoadableComponent
} from '@./lib/components/components';
import ApplicationServices from '../../../../../lib/services/ApplicationServices';
import { copyToClipboard } from '@./lib/commons/utils';
import Icon from '@ant-design/icons';
import { loadDestinations } from "@page/DestinationsPage/commons";
import useLoader from "@./lib/commons/useLoader";
import { useHistory } from "react-router-dom";

export function getIconSrc(destinationType: string): string {
  try {
    const icon = require('../../../../../icons/destinations/' + destinationType + '.svg');
    return icon.default;
  } catch (e) {
    console.log('Icon for ' + destinationType + ' is not found');
    return null;
  }
}

export function getIcon(destinationType: string): any {
  let src = getIconSrc(destinationType);
  return src ? <img src={src} className="destination-type-icon" alt="[destination]"/> : <DatabaseOutlined/>;
}

type DestinationComponentProps = {
  config: DestinationConfig
  destinations?: DestinationConfig[]
  onChange?: (destinations: DestinationConfig[]) => void
};

function DestinationTitle({ config }: DestinationComponentProps) {
  let configTitle = config.connectionTestOk ? <>{config.id}</> :
    <Tooltip
      trigger={['click', 'hover']}
      title={
        <>
          Last connection test failed with <b><i>'{config.connectionErrorMessage}'</i></b>. Destination might be not
          accepting data. Please, go to editor and fix the connection settings
        </>
      }>
        <span className="destinations-list-failed-connection">
          <b>!</b> {config.id}
        </span>
    </Tooltip>;
  if (config.comment) {
    return <LabelWithTooltip documentation={config.comment}>{configTitle}</LabelWithTooltip>;
  } else {
    return configTitle;
  }
}

function DestinationRow({ config, destinations, onChange }: DestinationComponentProps) {
  const history = useHistory();
  let description = config.describe();
  let descriptionComponent;
  if (!description.commandLineConnect) {
    descriptionComponent = description.displayURL;
  } else {
    let codeSnippet;
    if (description.commandLineConnect.indexOf('\n') < 0) {
      codeSnippet = <>
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
      </>;
    } else {
      codeSnippet = <CodeSnippet className="destinations-list-multiline-code" language="bash">
        {description.commandLineConnect}
      </CodeSnippet>
    }
    descriptionComponent = <Popover
      placement="topLeft"
      content={
        <>
          <h4><b>Use following command to connect to DB and run a test query:</b></h4>
          {codeSnippet}
        </>
      }
      trigger="click">
      <span className="destinations-list-show-connect-command">{description.displayURL}</span>
    </Popover>;
  }

  return <List.Item
    key={config.id}
    actions={[
      <Button icon={<EditOutlined/>} key="edit" shape="round" onClick={() => {
        history.push(`/destinations/edit/${config.id}`)
      }}>Edit</Button>,
      <Button icon={<DeleteOutlined/>} key="delete" shape="round" onClick={() => {
        Modal.confirm({
          title: 'Please confirm deletion of destination',
          icon: <ExclamationCircleOutlined/>,
          content: 'Are you sure you want to delete ' + config.id + ' destination?',
          okText: 'Delete',
          cancelText: 'Cancel',
          onOk: () => {
            destinations = destinations.filter(dest => dest.id !== config.id);
            onChange(destinations);
          },
          onCancel: () => {
          }
        });
      }}>
        Delete
      </Button>
    ]}
    className="destination-list-item">
    <List.Item.Meta
      avatar={<Avatar shape="square" src={getIconSrc(config.type)}/>}
      title={<DestinationTitle config={config} />}
      description={
        <>
          {descriptionComponent}
          <br/>
          mode: {config.mode}
        </>
      }
    />
  </List.Item>;

}

export default function DestinationsList() {
  const [error, destinations, updateDestinations] = useLoader(async() => await loadDestinations(ApplicationServices.get()))
  const history = useHistory();
  if (error) {
    return <CenteredError error={error} />
  } else if (!destinations) {
    return <CenteredSpin />
  }
  let componentList = [
    <List key="list" className="destinations-list" itemLayout="horizontal" header={(
      <Dropdown trigger={['click']} overlay={(
        <Menu className="destinations-list-add-menu">
          {destinationConfigTypes.map((type) => (
            <Menu.Item
              key={type.name}
              icon={
                <Icon
                  component={() => (
                    <img
                      height={16}
                      width={16}
                      src={getIconSrc(type.type)}
                      className="destination-type-icon"
                      alt="[destination]"
                    />
                  )}
                />
              }
              onClick={() => history.push(`/destinations/new/${(type.type)}`)}>
              Add {type.name}
            </Menu.Item>
          ))}
        </Menu>
      )}>
        <Button type="primary" icon={<PlusOutlined/>}>
          Add destination
        </Button>
      </Dropdown>
    )} split={true}>
      {destinations.map((config) => <DestinationRow
          key={config.id}
                                                    config={config}
                                                    destinations={destinations}
                                                    onChange={updateDestinations}
      />)}
    </List>
  ];

  return <>{componentList}</>;
}
