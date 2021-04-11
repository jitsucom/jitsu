import { BQConfig } from '@./lib/services/destinations';
import * as React from 'react';
import { Form, Input } from 'antd';
import {
  DestinationDialog,
  googleJsonKeyLabel
} from './DestinationDialog';

export default class BiqQueryDialog extends DestinationDialog<BQConfig> {
  items(): React.ReactNode {
    return (
      <>
        <Form.Item
          label="Project ID"
          name="bqProjectId"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true }]}
        >
          <Input type="text" />
        </Form.Item>
        <Form.Item
          label="Dataset"
          name="bqDataset"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: false }]}
        >
          <Input type="text" />
        </Form.Item>
        <Form.Item
          label={googleJsonKeyLabel()}
          name={'bqJSONKey'}
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'JSON Key is required' }]}
        >
          <Input.TextArea rows={10} className="destinations-list-json-textarea" allowClear={true} bordered={true} />
        </Form.Item>
        <Form.Item
          className={this.state.currentValue.formData['mode'] === 'batch' ? '' : 'destinations-list-hidden'}
          label="GCS Bucket"
          name="bqGCSBucket"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: this.state.currentValue.formData['mode'] === 'batch' }]}
        >
          <Input type="text" />
        </Form.Item>
      </>
    );
  }
}