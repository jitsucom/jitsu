// @Libs
import React from 'react';
import { Avatar, Checkbox, Form, List } from 'antd';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Components
import { getIconSrc } from '@page/DestinationsPage/partials/DestinationsList/DestinationsList';
import { loadDestinations } from '@page/DestinationsPage/commons';
import { CenteredError, CenteredSpin } from '@./lib/components/components';
// @Types
import { SourceFormDestinationsProps } from '@page/SourcesPage/partials/_common/SourceForm/SourceForm.types';
// @Hooks
import useLoader from '@./lib/commons/useLoader';

const SourceFormDestinations = ({ initialValues }: SourceFormDestinationsProps) => {
  const [error, destinations] = useLoader(async() => await loadDestinations(ApplicationServices.get()));

  if (error) {
    return <CenteredError error={error} />
  } else if (!destinations) {
    return <CenteredSpin />
  }

  return (
    <>
      <h3>Choose destinations</h3>
      <article>Lorem ispium</article>

      <Form.Item
        name="destinations"
        initialValue={initialValues.destinations}
        rules={destinations.length > 0 && [{ required: true, message: 'You have to choose at least one destination.' }]}
      >
        <Checkbox.Group>
          <List key="list" className="destinations-list" itemLayout="horizontal">
            {destinations.map((config) => {
              const description = config.describe();

              return <List.Item key={config.id}>
                <label htmlFor={config.id} className="ant-checkbox-group-label">
                  <List.Item.Meta
                    avatar={<div className="ant-checkbox-group-label__avatar">
                      <Checkbox id={config.id} value={config.id} />
                      <Avatar shape="square" src={getIconSrc(config.type)}/>
                    </div>}
                    description={<span className="destinations-list-show-connect-command">{description.displayURL}</span>}
                    title={config.connectionTestOk
                      ? config.id
                      : <span className="destinations-list-failed-connection">
                        <b>!</b> {config.id}
                      </span>}
                  />
                </label>
              </List.Item>
            })}
          </List>
        </Checkbox.Group>
      </Form.Item>
    </>
  );
};

export { SourceFormDestinations }
