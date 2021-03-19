import { RedshiftConfig } from '@./lib/services/destinations';
import * as React from 'react';
import { Col, Divider, Form, Input, Row, Switch } from 'antd';
import { LabelWithTooltip } from '@./lib/components/components';
import {
  DestinationDialog,
  s3ConfigComponents
} from '@page/DestinationsPage/partials/DestinationDialog/DestinationDialog';

export default class RedshiftDestinationDialog extends DestinationDialog<RedshiftConfig> {
  items(): React.ReactNode {
    let s3Doc = (
      <>
        If the switch is enabled internal S3 bucket will be used. You won't be able to see raw logs. However, the data
        will be streamed to RedShift as-is. You still need to choose a S3 region which is most close to your redshift
        server to get the best performance
      </>
    );
    let className =
      'destinations-list-s3config-' + (this.state.currentValue.formData['mode'] === 'batch' ? 'enabled' : 'disabled');
    return (
      <>
        <Row>
          <Col span={16}>
            <Form.Item
              label="Host"
              name="redshiftHost"
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
              rules={[{ required: true, message: 'Host is required' }]}
            >
              <Input type="text"/>
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          label="Database"
          name="redshiftDB"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'DB is required' }]}
        >
          <Input type="text"/>
        </Form.Item>
        <Form.Item
          label="Schema"
          name="redshiftSchema"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Schema is required' }]}
        >
          <Input type="text"/>
        </Form.Item>
        <Form.Item
          label="Username"
          name="redshiftUser"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Username is required' }]}
        >
          <Input type="text"/>
        </Form.Item>
        <Form.Item
          label="Password"
          name="redshiftPassword"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Password is required' }]}
        >
          <Input type="password"/>
        </Form.Item>
        <Divider className={className} plain>
          <>
            <LabelWithTooltip
              documentation={
                <>
                  If destination is working in batch mode (read about modes differences here), intermediate batches is
                  stored on S3. You need to provide S3 credentials. You can use S3 hosted by us as well, just switch off
                  'Use hosted S3 bucket' setting
                </>
              }
            >
              S3 configuration
            </LabelWithTooltip>
          </>
        </Divider>
        <Form.Item
          className={className}
          label={<LabelWithTooltip documentation={s3Doc}>Use Jitsu S3 bucket</LabelWithTooltip>}
          name="redshiftUseHostedS3"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 8 }}
          rules={[
            {
              required: this.state.currentValue.formData['mode'] === 'batch',
              message: 'Required'
            }
          ]}
        >
          <Switch
            disabled={!(this.state.currentValue.formData['mode'] === 'batch')}
            onChange={() => {
              this.refreshStateFromForm();
            }}
          />
        </Form.Item>
        {s3ConfigComponents(
          'redshift',
          !(this.state.currentValue.formData['mode'] === 'batch') ||
          this.state.currentValue.formData['redshiftUseHostedS3']
        )}
      </>
    );
  }
}
