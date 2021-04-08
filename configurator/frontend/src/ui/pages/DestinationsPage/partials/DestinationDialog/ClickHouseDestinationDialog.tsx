import { ClickHouseConfig } from '@./lib/services/destinations';
import * as React from 'react';
import { CodeInline } from '@./lib/components/components';
import { Col, Form, Input, Row } from 'antd';
import { EditableList } from '@./lib/components/EditableList/EditableList';
import { DestinationDialog } from '@page/DestinationsPage/partials/DestinationDialog/DestinationDialog';
import { LabelWithTooltip } from '@atom/LabelWithTooltip';

export default class ClickHouseDestinationDialog extends DestinationDialog<ClickHouseConfig> {
  isUrlValid(val) {
    let res = val.match(/((http(s)?|tcp):\/\/.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/g);
    return res != null;
  }

  items(): React.ReactNode {
    this.state.currentValue.migrateData();
    let dsnDocs = (
      <>
        A list of DSNs (server names). It's recommended to add at least two servers within the cluster for
        redundancy{' '}
        <a
          href="https://docs.eventnative.org/configuration-1/destination-configuration/clickhouse-destination#clickhouse)">
          documentation
        </a>
      </>
    );
    let clusterDoc = (
      <>
        <p>
          Cluster name. See{' '}
          <a
            href="https://docs.eventnative.org/configuration-1/destination-configuration/clickhouse-destination#clickhouse)">
            documentation
          </a>
          .
        </p>
        <p>
          Run <CodeInline>SELECT * from system.clusters</CodeInline> to the list of all available clusters
        </p>
      </>
    );
    let databaseDoc = (
      <>
        Database name. See{' '}
        <a
          href="https://docs.eventnative.org/configuration-1/destination-configuration/clickhouse-destination#clickhouse)">
          documentation
        </a>
      </>
    );

    const dsnValidator = (val) => {
      if (val === '') {
        return "Value can't be empty";
      }
      if (!this.isUrlValid(val)) {
        return 'URL is not valid should be [tcp|http(s)]://host[:port]?params';
      }
      return null;
    };
    return (
      <>
        <Row>
          <Col span={16}>
            <Form.Item
              label={<LabelWithTooltip documentation={dsnDocs} render="Datasources" />}
              name="ch_dsns_list"
              rules={[
                {
                  validator: (rule, value, callback) => {
                    if (value.filter((val) => dsnValidator(val) != null).length > 0) {
                      callback('One of the urls are not valid, see above');
                    }
                    return Promise.resolve();
                  }
                }
              ]}
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
            >
              <EditableList newItemLabel="Add new server" validator={dsnValidator}/>
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          label={<LabelWithTooltip documentation={clusterDoc} render="Cluster" />}
          rules={[{ required: true, message: 'Cluster name is required' }]}
          name="ch_cluster"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
        >
          <Input type="text"/>
        </Form.Item>
        <Form.Item
          label={<LabelWithTooltip documentation={databaseDoc} render="Database" />}
          rules={[{ required: true, message: 'DB is required' }]}
          name="ch_database"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
        >
          <Input type="text"/>
        </Form.Item>
      </>
    );
  }
}

