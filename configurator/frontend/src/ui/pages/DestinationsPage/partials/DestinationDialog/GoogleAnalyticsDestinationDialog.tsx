import { GoogleAnalyticsConfig } from '@./lib/services/destinations';
import * as React from 'react';
import { Col, Form, Input, Row } from 'antd';
import {
  DestinationDialog,
  IDestinationDialogProps
} from '@page/DestinationsPage/partials/DestinationDialog/DestinationDialog';

export default class GoogleAnalyticsDestinationDialog extends DestinationDialog<GoogleAnalyticsConfig> {
  constructor(
    props: Readonly<IDestinationDialogProps<GoogleAnalyticsConfig>> | IDestinationDialogProps<GoogleAnalyticsConfig>
  ) {
    super(props);
  }

  protected getDefaultMode(): string {
    return 'stream';
  }

  protected isTableNameSupported(): boolean {
    return true;
  }

  items(): React.ReactNode {
    return (
      <>
        <Row>
          <Col span={16}>
            <Form.Item
              label="Tracking ID"
              name="gaTrackingId"
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
              rules={[{ required: true, message: 'Tracking ID is required' }]}
            >
              <Input type="text"/>
            </Form.Item>
          </Col>
        </Row>
      </>
    );
  }
}

