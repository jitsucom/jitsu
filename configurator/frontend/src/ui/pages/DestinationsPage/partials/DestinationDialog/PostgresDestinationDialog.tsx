import { PostgresConfig } from "@./lib/services/destinations";
import * as React from "react";
import { Col, Form, Input, Row } from "antd";
import EyeTwoTone from "@ant-design/icons/lib/icons/EyeTwoTone";
import EyeInvisibleOutlined from "@ant-design/icons/lib/icons/EyeInvisibleOutlined";
import {
  DestinationDialog,
  IDestinationDialogProps
} from "@page/DestinationsPage/partials/DestinationDialog/DestinationDialog";

export default class PostgresDestinationDialog extends DestinationDialog<PostgresConfig> {
  constructor(props: Readonly<IDestinationDialogProps<PostgresConfig>> | IDestinationDialogProps<PostgresConfig>) {
    super(props);
  }

  items(): React.ReactNode {
    return (
      <>
        <Row>
          <Col span={16}>
            <Form.Item
              label="Host"
              name="pghost"
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
              rules={[{ required: true, message: 'Host is required' }]}
            >
              <Input type="text"/>
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              label="Port"
              name="pgport"
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 6 }}
              rules={[{ required: true, message: 'Port is required' }]}
            >
              <Input type="number"/>
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          label="Schema"
          name="pgschema"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Schema is required' }]}
        >
          <Input type="text"/>
        </Form.Item>
        <Form.Item
          label="Database"
          name="pgdatabase"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'DB is required' }]}
        >
          <Input type="text"/>
        </Form.Item>
        <Form.Item
          label="Username"
          name="pguser"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Username is required' }]}
        >
          <Input type="text"/>
        </Form.Item>
        <Form.Item
          label="Password"
          name="pgpassword"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Password is required' }]}
        >
          <Input.Password
            placeholder="input password"
            iconRender={(visible) => (visible ? <EyeTwoTone/> : <EyeInvisibleOutlined/>)}
          />
        </Form.Item>
      </>
    );
  }
}
