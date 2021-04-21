// @Libs
import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Form, List, Switch, Typography } from 'antd';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Components
import { CenteredError, CenteredSpin } from '@./lib/components/components';
// @Types
import { SourceFormDestinationsProps } from './SourceForm.types';
// @Hooks
import useLoader from '@hooks/useLoader';
import { destinationsReferenceMap } from '@page/DestinationsPage/commons';
import { Destination } from '@catalog/destinations/types';

const SourceFormDestinations = ({ initialValues, form }: SourceFormDestinationsProps) => {
  const services = useMemo(() => ApplicationServices.get(), []);

  const [error, destinations] = useLoader(
    async() => await services.storageService.get('destinations', services.activeProject.id)
  );

  const [checkedDestinations, setCheckedDestinations] = useState<string[]>(initialValues.destinations ?? []);

  const handleChange = useCallback((config: DestinationData) => (checked: boolean) => {
    let newDestinations;

    if (checked && !checkedDestinations.includes(config._uid)) {
      newDestinations = [...checkedDestinations, config._uid];
    } else if (!checked) {
      newDestinations = checkedDestinations.filter((destination: string) => destination !== config._uid);
    }

    setCheckedDestinations(newDestinations);

    const formValues = form.getFieldsValue();

    form.setFieldsValue({
      ...formValues,
      destinations: newDestinations
    });
  }, [checkedDestinations, form]);

  if (error) {
    return <CenteredError error={error} />
  } else if (!destinations) {
    return <CenteredSpin />
  }

  return (
    <>
      <h3>Choose destinations</h3>
      <article className="mb-5">
        <p>Destination is a database where reports data will be aggregated. Read more about destinations in our <a href="https://jitsu.com/docs/destinations-configuration" target="_blank" rel="noreferrer">documentation</a>.</p>
        {
          destinations?.destinations?.length > 0
            ? <>
              <p>You have to choose at least one destination.</p>
            </>
            : <p>If you haven't added any destinations yet you can do it <Link to="/destinations">here</Link>.</p>
        }
      </article>

      <Form.Item
        name="destinations"
        initialValue={initialValues.destinations}
      >
        <List key="list" className="destinations-list" itemLayout="horizontal">
          {destinations.destinations.map((d: DestinationData) => {
            const destinationProto: Destination = destinationsReferenceMap[d._type];
            const { title } = destinationProto.ui;

            return <List.Item key={d._uid}>
              <label htmlFor={d._uid} className="ant-switch-group-label">
                <List.Item.Meta
                  avatar={<div className="ant-switch-group-label__avatar">
                    <Switch onChange={handleChange(d)} checked={checkedDestinations.includes(d._uid)} />
                    <Avatar shape="square" src={destinationProto.ui.icon}/>
                  </div>}
                  description={<span className="destinations-list-show-connect-command">{title(d)}</span>}
                  title={d._connectionTestOk
                    ? d._id
                    : <span className="destinations-list-failed-connection">
                      <b>!</b> {d._id}
                    </span>}
                />
              </label>
            </List.Item>
          })}
        </List>
      </Form.Item>

      {
        destinations.length > 0 && checkedDestinations.length === 0 && <Typography.Text type="warning">Please, choose at least one destination.</Typography.Text>
      }
    </>
  );
};

export { SourceFormDestinations }
