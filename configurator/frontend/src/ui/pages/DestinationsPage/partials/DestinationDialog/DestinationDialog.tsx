import { DestinationConfig } from "@./lib/services/destinations";
import * as React from "react";
import { ReactNode } from "react";
import { Col, Form, Input, Radio, Row, Select } from "antd";
import { LabelWithTooltip } from "@./lib/components/components";
import { Option } from "antd/es/mentions";
import EyeTwoTone from "@ant-design/icons/lib/icons/EyeTwoTone";
import EyeInvisibleOutlined from "@ant-design/icons/lib/icons/EyeInvisibleOutlined";

export const AWS_ZONES = [
  'us-east-2',
  'us-east-1',
  'us-west-1',
  'us-west-2',
  'ap-south-1',
  'ap-northeast-3',
  'ap-northeast-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ca-central-1',
  'cn-north-1',
  'cn-northwest-1',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-south-1',
  'eu-west-3',
  'eu-north-1',
  'me-south-1',
  'sa-east-1',
  'us-gov-east-1',
  'us-gov-west-1'
];

export type IDestinationDialogProps<T extends DestinationConfig> = {
  initialConfigValue: T;
  form: any;
  onModification: () => void
};

export type IDestinationDialogState<T extends DestinationConfig> = {
  currentValue: T;
};

export abstract class DestinationDialog<T extends DestinationConfig> extends React.Component<IDestinationDialogProps<T>,
  IDestinationDialogState<T>> {
  constructor(props: Readonly<IDestinationDialogProps<T>> | IDestinationDialogProps<T>) {
    super(props);
    this.state = {
      currentValue: props.initialConfigValue
    };
  }

  protected getDefaultMode(): string {
    return null;
  }

  protected isTableNameSupported(): boolean {
    return true;
  }

  public render() {
    let tableName = <>
      Table name can be either constant (in that case all events will be written into the same table) or can be an
      event filter{' '}
      <a
        target="_blank"
        rel="noopener"
        href={'https://docs.eventnative.org/configuration-1/configuration/table-names-and-filters'}
      >
        Read more
      </a>
    </>;

    return <Form layout="horizontal"
                 form={this.props.form}
                 initialValues={this.state.currentValue.formData}
                 onChange={() => this.props.onModification()}
    >
      {!this.getDefaultMode() && <Form.Item label="Mode" name="mode" labelCol={{ span: 4 }} wrapperCol={{ span: 18 }}>
        <Radio.Group buttonStyle="solid" onChange={() => this.refreshStateFromForm()}>
          <Radio.Button value="stream">Streaming</Radio.Button>
          <Radio.Button value="batch">Batch</Radio.Button>
        </Radio.Group>
      </Form.Item>}

      {this.isTableNameSupported() && <Form.Item
        label={<LabelWithTooltip documentation={tableName}>Table Name</LabelWithTooltip>}
        name="tableName"
        labelCol={{ span: 4 }}
        wrapperCol={{ span: 12 }}
        required={true}>
        <Input type="text"/>
      </Form.Item>}
      {this.items()}
    </Form>;
  }

  public getCurrentConfig(): T {
    return this.state.currentValue;
  }

  public abstract items(): ReactNode;

  public refreshStateFromForm() {
    console.log('Refreshing state', this.props.form.getFieldsValue());
    this.state.currentValue.update(this.props.form.getFieldsValue());
    this.forceUpdate();
  }
}

export function s3ConfigComponents(prefix: string, disabled: boolean) {
  let className = 'destinations-list-s3config-' + (disabled ? 'disabled' : 'enabled');
  return (
    <>
      <Row>
        <Col span={8}>
          <Form.Item
            className={className}
            label="S3 Region"
            name={prefix + 'S3Region'}
            labelCol={{ span: 12 }}
            wrapperCol={{ span: 12 }}
            rules={[{ required: !disabled, message: 'DB is required' }]}
          >
            <Select disabled={disabled}>
              {AWS_ZONES.map((zone) => (
                <Option key={zone} value={zone}>
                  {zone}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            className={className}
            label="Bucket"
            name={prefix + 'S3Bucket'}
            labelCol={{ span: 6 }}
            wrapperCol={{ span: 18 }}
            rules={[{ required: !disabled, message: 'S3 Bucket is required' }]}
          >
            <Input type="text" disabled={disabled}/>
          </Form.Item>
        </Col>
        <Col span={8}></Col>
      </Row>

      <Form.Item
        className={className}
        label="S3 Access Key"
        name={prefix + 'S3AccessKey'}
        labelCol={{ span: 4 }}
        wrapperCol={{ span: 12 }}
        rules={[{ required: !disabled, message: 'S3 Access Key is required' }]}
      >
        <Input type="text" disabled={disabled}/>
      </Form.Item>
      <Form.Item
        className={className}
        label="S3 Secret Key"
        name={prefix + 'S3SecretKey'}
        labelCol={{ span: 4 }}
        wrapperCol={{ span: 12 }}
        rules={[{ required: !disabled, message: 'S3 Secret Key is required' }]}
      >
        <Input.Password
          type="password"
          disabled={disabled}
          iconRender={(visible) => (visible ? <EyeTwoTone/> : <EyeInvisibleOutlined/>)}
        />
      </Form.Item>
    </>
  );
}

export function googleJsonKeyLabel() {
  return <LabelWithTooltip documentation={<>JSON access credentials</>}>Access Key</LabelWithTooltip>;
}

export function gcsConfigComponents(prefix: string, disabled: boolean) {
  let className = 'destinations-list-s3config-' + (disabled ? 'disabled' : 'enabled');
  return (
    <>
      <Form.Item
        className={className}
        label="GCS Bucket"
        name={prefix + 'GcsBucket'}
        labelCol={{ span: 4 }}
        wrapperCol={{ span: 12 }}
        rules={[{ required: !disabled }]}
      >
        <Input type="text" disabled={disabled}/>
      </Form.Item>
      <Form.Item
        className={className}
        label={googleJsonKeyLabel()}
        name={prefix + 'JSONKey'}
        labelCol={{ span: 4 }}
        wrapperCol={{ span: 12 }}
        rules={[{ required: !disabled, message: 'JSON Key is required' }]}
      >
        <Input.TextArea className="destinations-list-json-textarea" allowClear={true} bordered={true}/>
      </Form.Item>
    </>
  );
}

