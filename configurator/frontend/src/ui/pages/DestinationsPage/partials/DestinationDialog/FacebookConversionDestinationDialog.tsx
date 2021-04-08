import { FacebookConversionConfig } from '@./lib/services/destinations';
import * as React from 'react';
import { Col, Form, Input, Row } from 'antd';
import { LabelWithTooltip } from '@atom/LabelWithTooltip';
import {
  DestinationDialog,
  IDestinationDialogProps
} from '@page/DestinationsPage/partials/DestinationDialog/DestinationDialog';

export default class FacebookConversionDestinationDialog extends DestinationDialog<FacebookConversionConfig> {
  constructor(
    props:
      | Readonly<IDestinationDialogProps<FacebookConversionConfig>>
      | IDestinationDialogProps<FacebookConversionConfig>
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
    let pixelIdDoc = (
      <>
        Your Facebook Pixel ID or{' '}
        <a target="_blank" rel="noopener noreferrer" href={'https://www.facebook.com/ads/manager/pixel/facebook_pixel/'}>
          create a new one
        </a>
        .
        <br/>
        Read more about{' '}
        <a
          target="_blank"
          rel="noopener noreferrer"
          href={'https://developers.facebook.com/docs/marketing-api/conversions-api/get-started#-------'}
        >
          Facebook conversion API
        </a>
      </>
    );
    let accessTokenDoc = (
      <>
        Your Facebook Access Token.
        <br/>
        <a
          target="_blank"
          rel="noopener noreferrer"
          href={'https://developers.facebook.com/docs/marketing-api/conversions-api/get-started#--------------'}
        >
          Read more
        </a>
      </>
    );
    return (
      <>
        <Row>
          <Col span={16}>
            <Form.Item
              label={<LabelWithTooltip documentation={pixelIdDoc} render="Pixel ID" />}
              name="fbPixelId"
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
              rules={[{ required: true, message: 'Pixel ID is required' }]}
            >
              <Input type="text"/>
            </Form.Item>
            <Form.Item
              label={<LabelWithTooltip documentation={accessTokenDoc} render="Access Token" />}
              name="fbAccessToken"
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
              rules={[{ required: true, message: 'Access Token is required' }]}
            >
              <Input type="text"/>
            </Form.Item>
          </Col>
        </Row>
      </>
    );
  }
}
