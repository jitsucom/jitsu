import { SnowflakeConfig } from "@./lib/services/destinations";
import * as React from "react";
import { Col, Divider, Form, Input, Radio, Row } from "antd";
import EyeTwoTone from "@ant-design/icons/lib/icons/EyeTwoTone";
import EyeInvisibleOutlined from "@ant-design/icons/lib/icons/EyeInvisibleOutlined";
import { LabelWithTooltip } from "@./lib/components/components";
import {
  DestinationDialog, gcsConfigComponents,
  s3ConfigComponents
} from "@page/DestinationsPage/partials/DestinationDialog/DestinationDialog";

export class SnowFlakeDestinationDialog extends DestinationDialog<SnowflakeConfig> {
  items(): React.ReactNode {
    let className =
      'destinations-list-s3config-' + (this.state.currentValue.formData['mode'] === 'batch' ? 'enabled' : 'disabled');
    return (
      <>
        <Row>
          <Col span={16}>
            <Form.Item
              label="Account"
              name="snowflakeAccount"
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
              rules={[{ required: true, message: 'Field is required' }]}
            >
              <Input type="text"/>
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          label="Warehouse"
          name="snowflakeWarehouse"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Field is required' }]}
        >
          <Input type="text"/>
        </Form.Item>
        <Form.Item
          label="DB"
          name="snowflakeDB"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Field is required' }]}
        >
          <Input type="text"/>
        </Form.Item>
        <Form.Item
          label="Schema"
          initialValue="public"
          name="snowflakeSchema"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Field is required' }]}
        >
          <Input type="text"/>
        </Form.Item>
        <Form.Item
          label="Username"
          name="snowflakeUsername"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Field is required' }]}
        >
          <Input type="text"/>
        </Form.Item>
        <Form.Item
          label="Password"
          name="snowflakePassword"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Field is required' }]}
        >
          <Input.Password
            type="password"
            iconRender={(visible) => (visible ? <EyeTwoTone/> : <EyeInvisibleOutlined/>)}
          />
        </Form.Item>
        <Divider className={className} plain>
          <LabelWithTooltip
            documentation={
              <>
                For batch mode data is being uploaded through{' '}
                <a href="https://docs.snowflake.com/en/user-guide/data-load-local-file-system-create-stage.html">
                  stages
                </a>
                . We support S3 and GCP as stage.
              </>
            }
          >
            Intermediate Stage (S3 or GCP)
          </LabelWithTooltip>
        </Divider>

        <Form.Item
          label="Stage name"
          className={className}
          name="snowflakeStageName"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[
            {
              required: this.state.currentValue.formData['mode'] === 'batch',
              message: 'Field is required'
            }
          ]}
        >
          <Input type="text"/>
        </Form.Item>

        <Form.Item
          className={className}
          label="Stage type"
          name="snowflakeStageType"
          initialValue={'hosted'}
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 8 }}
          rules={[
            {
              required: this.state.currentValue.formData['mode'] === 'batch',
              message: 'Required'
            }
          ]}
        >
          <Radio.Group optionType="button" buttonStyle="solid" onChange={() => this.refreshStateFromForm()}>
            <Radio.Button value="hosted">Hosted by Jitsu</Radio.Button>
            <Radio.Button value="s3">S3</Radio.Button>
            <Radio.Button value="gcs">Google Cloud Storage</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {s3ConfigComponents(
          'snowflake',
          !(
            this.state.currentValue.formData['mode'] === 'batch' &&
            this.state.currentValue.formData['snowflakeStageType'] === 's3'
          )
        )}
        {gcsConfigComponents(
          'snowflake',
          !(
            this.state.currentValue.formData['mode'] === 'batch' &&
            this.state.currentValue.formData['snowflakeStageType'] === 'gcs'
          )
        )}
      </>
    );
  }
}

export default SnowFlakeDestinationDialog;
