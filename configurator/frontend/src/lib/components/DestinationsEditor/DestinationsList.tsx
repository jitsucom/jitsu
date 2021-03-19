/* eslint-disable */
import * as React from 'react';
import { ReactNode, useState } from 'react';
import {
  BQConfig,
  ClickHouseConfig,
  DestinationConfig,
  destinationConfigTypes,
  destinationsByTypeId,
  FacebookConversionConfig,
  GoogleAnalyticsConfig,
  PostgresConfig,
  RedshiftConfig,
  SnowflakeConfig
} from '../../services/destinations';
import {
  Avatar,
  Button,
  Col,
  Divider,
  Dropdown,
  Form,
  Input,
  List,
  Menu,
  message,
  Modal,
  Popover,
  Radio,
  Row,
  Select,
  Switch,
  Tooltip
} from 'antd';

import ColumnWidthOutlined from '@ant-design/icons/lib/icons/ColumnWidthOutlined';
import DatabaseOutlined from '@ant-design/icons/lib/icons/DatabaseOutlined';
import DeleteOutlined from '@ant-design/icons/lib/icons/DeleteOutlined';
import EditOutlined from '@ant-design/icons/lib/icons/EditOutlined';
import ExclamationCircleOutlined from '@ant-design/icons/lib/icons/ExclamationCircleOutlined';
import EyeInvisibleOutlined from '@ant-design/icons/lib/icons/EyeInvisibleOutlined';
import EyeTwoTone from '@ant-design/icons/lib/icons/EyeTwoTone';
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';

import './DestinationEditor.less';
import {
  ActionLink,
  Align,
  CodeInline,
  CodeSnippet,
  handleError,
  LabelWithTooltip,
  LoadableComponent
} from '../components';
import ApplicationServices from '../../services/ApplicationServices';
import { copyToClipboard, firstToLower, IndexedList } from '../../commons/utils';
import Marshal from '../../commons/marshalling';
import { Option } from 'antd/es/mentions';
import { FieldMappings, Mapping } from '../../services/mappings';
import { MappingEditor } from './MappingEditor';
import Icon from '@ant-design/icons';
import { EditableList } from '../EditableList/EditableList';

const AWS_ZONES = [
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

type State = {
  destinations?: IndexedList<DestinationConfig>;
  activeEditorConfig?: DestinationConfig;
  activeMapping?: FieldMappings;
};

const SERIALIZABLE_CLASSES = [
  DestinationConfig,
  PostgresConfig,
  ClickHouseConfig,
  RedshiftConfig,
  FieldMappings,
  Mapping,
  SnowflakeConfig,
  BQConfig,
  GoogleAnalyticsConfig,
  FacebookConversionConfig
];

export default class DestinationsList extends LoadableComponent<any, State> {
  private services: ApplicationServices;

  constructor(props: Readonly<any>, context: any) {
    super(props, context);
    this.services = ApplicationServices.get();
  }

  private newDestinationsList(items?: DestinationConfig[]) {
    let list = new IndexedList<DestinationConfig>((config: DestinationConfig) => config.id);
    items.forEach((item) => list.push(item));
    return list;
  }

  protected async load() {
    let destinations = await this.services.storageService.get('destinations', this.services.activeProject.id);
    return {
      destinations: this.newDestinationsList(
        destinations && destinations.destinations
          ? Marshal.newInstance(destinations.destinations, SERIALIZABLE_CLASSES)
          : []
      ),
      loading: false
    };
  }

  destinationComponent(config: DestinationConfig): ReactNode {
    let onClick = () => this.delete(config);
    let onMappings = () => {
      this.setState({
        activeMapping: config.mappings ? config.mappings : new FieldMappings([], true),
        activeEditorConfig: config
      });
    };
    let onEdit = () => {
      let destinationType = destinationsByTypeId[config.type];
      if (dialogsByType[config.type]) {
        this.setState({
          activeEditorConfig: config
        });
      } else {
        Modal.warning({
          title: 'Not supported',
          content: destinationType.name + ' destination is not supported yet'
        });
      }
    };

    let description = config.describe();
    let descriptionComponent;
    if (!description.commandLineConnect) {
      descriptionComponent = description.displayURL;
    } else {
      let codeSnippet;
      if (description.commandLineConnect.indexOf('\n') < 0) {
        codeSnippet = (
          <>
            <div>
              <CodeInline>{description.commandLineConnect}</CodeInline>
            </div>
            <Align horizontal="right">
              <ActionLink
                onClick={() => {
                  copyToClipboard(description.commandLineConnect);
                  message.info('Command copied to clipboard', 2);
                }}
              >
                Copy command to clipboard
              </ActionLink>
            </Align>
          </>
        );
      } else {
        codeSnippet = (
          <>
            <CodeSnippet className="destinations-list-multiline-code" language="bash">
              {description.commandLineConnect}
            </CodeSnippet>
          </>
        );
      }
      descriptionComponent = (
        <>
          <Popover
            placement="topLeft"
            content={
              <>
                <h4>
                  <b>Use following command to connect to DB and run a test query:</b>
                </h4>
                {codeSnippet}
              </>
            }
            trigger="click"
          >
            <span className="destinations-list-show-connect-command">{description.displayURL}</span>
          </Popover>
        </>
      );
    }

    return (
      <List.Item
        key={config.id}
        actions={[
          <Button icon={<ColumnWidthOutlined />} key="edit" shape="round" onClick={onMappings}>
            Mappings
          </Button>,
          <Button icon={<EditOutlined />} key="edit" shape="round" onClick={onEdit}>
            Edit
          </Button>,
          <Button icon={<DeleteOutlined />} key="delete" shape="round" onClick={onClick}>
            Delete
          </Button>
        ]}
        className="destination-list-item"
      >
        <List.Item.Meta
          avatar={<Avatar shape="square" src={DestinationsList.getIconSrc(config.type)} />}
          title={this.getTitle(config)}
          description={
            <>
              {descriptionComponent}
              <br />
              mode: {config.mode}
            </>
          }
        />
      </List.Item>
    );
  }

  private getTitle(config: DestinationConfig): ReactNode {
    let configTitle = config.connectionTestOk ? (
      config.id
    ) : (
      <Tooltip
        trigger={['click', 'hover']}
        title={
          <>
            Last connection test failed with{' '}
            <b>
              <i>'{config.connectionErrorMessage}'</i>
            </b>
            . Destination might be not accepting data. Please, go to editor and fix the connection settings
          </>
        }
      >
        <span className="destinations-list-failed-connection">
          <b>!</b> {config.id}
        </span>
      </Tooltip>
    );
    if (config.comment) {
      return <LabelWithTooltip documentation={config.comment}>{configTitle}</LabelWithTooltip>;
    } else {
      return configTitle;
    }
  }

  private static getIconSrc(destinationType: string): any {
    try {
      const icon = require('../../../icons/destinations/' + destinationType + '.svg');
      console.log("Icon", icon)
      return icon.default;
    } catch (e) {
      console.log('Icon for ' + destinationType + ' is not found');
      return null;
    }
  }

  static getIcon(destinationType: string): any {
    let src = this.getIconSrc(destinationType);
    return src ? <img src={src} className="destination-type-icon" alt="[destination]" /> : <DatabaseOutlined />;
  }

  renderReady() {
    let componentList = [
      <List key="list" className="destinations-list" itemLayout="horizontal" header={this.addButton()} split={true}>
        {this.state.destinations.toArray().map((config) => this.destinationComponent(config))}
      </List>
    ];

    if (this.state.activeMapping) {
      componentList.push(
        <MappingEditor
          key="mapping-editor"
          entity={this.state.activeMapping}
          onChange={async (newMapping) => {
            this.state.activeEditorConfig.mappings = newMapping;
            await this.saveCurrentDestinations();
          }}
          closeDialog={() => {
            this.setState({ activeMapping: null, activeEditorConfig: null });
          }}
        />
      );
    } else if (this.state.activeEditorConfig) {
      componentList.push(
        <DestinationsEditorModal
          key="active-modal"
          config={this.state.activeEditorConfig}
          onCancel={() => this.setState({ activeEditorConfig: null })}
          testConnection={async (values) => {
            this.state.activeEditorConfig.update(values);
            await this.services.backendApiClient.post(
              '/destinations/test',
              Marshal.toPureJson(this.state.activeEditorConfig)
            );
            return values;
          }}
          onSave={(formValues, connectionTestResult) => {
            this.state.activeEditorConfig.update(formValues);
            this.state.activeEditorConfig.setConnectionTestResult(connectionTestResult);
            this.state.activeEditorConfig.trim();
            this.state.destinations.addOrUpdate(this.state.activeEditorConfig);
            if (this.saveCurrentDestinations()) {
              if (connectionTestResult) {
                message.warn(
                  `Destination has been saved, but test has failed with '${firstToLower(
                    connectionTestResult
                  )}'. Data will not be piped to this destination`,
                  10
                );
              } else {
                message.success('Destination has been saved');
              }
            }
          }}
        />
      );
    }
    return <>{componentList}</>;
  }

  private async saveCurrentDestinations(): Promise<boolean> {
    let payload = { destinations: this.state.destinations.toArray() };
    try {
      await this.services.storageService.save('destinations', payload, this.services.activeProject.id);
    } catch (e) {
      message.error('Interval error, destination has not been saved!', 10);
      return false;
    }

    this.setState({
      destinations: this.state.destinations,
      activeEditorConfig: null,
      activeMapping: null
    });
    return true;
  }

  private addButton() {
    return (
      <Dropdown trigger={['click']} overlay={this.addMenu()}>
        <Button type="primary" icon={<PlusOutlined />}>
          Add destination
        </Button>
      </Dropdown>
    );
  }

  addMenu() {
    return (
      <Menu className="destinations-list-add-menu">
        {destinationConfigTypes.map((type) => (
          <Menu.Item
            key={type.name}
            icon={
              <Icon
                component={() => (
                  <img
                    height={16}
                    width={16}
                    src={DestinationsList.getIconSrc(type.type)}
                    className="destination-type-icon"
                    alt="[destination]"
                  />
                )}
              />
            }
            onClick={() => this.addDestination(type.type)}
          >
            Add {type.name}
          </Menu.Item>
        ))}
      </Menu>
    );
  }

  public delete(config: DestinationConfig) {
    Modal.confirm({
      title: 'Please confirm deletion of destination',
      icon: <ExclamationCircleOutlined />,
      content: 'Are you sure you want to delete ' + config.id + ' destination?',
      okText: 'Delete',
      cancelText: 'Cancel',
      onOk: () => {
        this.state.destinations.remove(config.id);
        this.saveCurrentDestinations();
      },
      onCancel: () => {}
    });
  }

  private addDestination(type: string) {
    let destinationType = destinationsByTypeId[type];
    if (dialogsByType[type]) {
      this.setState({
        activeEditorConfig: destinationType.factory(this.pickId(type))
      });
    } else {
      Modal.warning({
        title: 'Not supported',
        content: destinationType.name + ' destination is not supported yet'
      });
    }
    return;
  }

  private pickId(type) {
    let id = type;
    let baseId = type;
    let counter = 1;
    while (this.state.destinations.toArray().find((el) => el.id == id) !== undefined) {
      id = baseId + counter;
      counter++;
    }
    return id;
  }
}

type IDestinationDialogProps<T extends DestinationConfig> = {
  initialConfigValue: T;
  form: any;
};

type IDestinationDialogState<T extends DestinationConfig> = {
  currentValue: T;
};

abstract class DestinationDialog<T extends DestinationConfig> extends React.Component<
  IDestinationDialogProps<T>,
  IDestinationDialogState<T>
> {
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
    let tableName = (
      <>
        Table name can be either constant (in that case all events will be written into the same table) or can be an
        event filter{' '}
        <a
          target="_blank"
          rel="noopener"
          href={'https://docs.eventnative.org/configuration-1/configuration/table-names-and-filters'}
        >
          Read more
        </a>
      </>
    );
    let modeValues;
    if (this.getDefaultMode() == null) {
      modeValues = (
        <>
          <Radio.Button value="stream">Streaming</Radio.Button>
          <Radio.Button value="batch">Batch</Radio.Button>
        </>
      );
    } else if (this.getDefaultMode() == 'stream') {
      modeValues = <Radio.Button value="stream">Streaming</Radio.Button>;
    } else {
      modeValues = <Radio.Button value="batch">Batch</Radio.Button>;
    }

    let tableNameItem;
    if (this.isTableNameSupported()) {
      tableNameItem = (
        <Form.Item
          label={<LabelWithTooltip documentation={tableName}>Table Name</LabelWithTooltip>}
          name="tableName"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          required={true}
        >
          <Input type="text" />
        </Form.Item>
      );
    }

    return (
      <Form layout="horizontal" form={this.props.form} initialValues={this.state.currentValue.formData}>
        <Form.Item label="Mode" name="mode" labelCol={{ span: 4 }} wrapperCol={{ span: 18 }}>
          <Radio.Group optionType="button" buttonStyle="solid" onChange={() => this.refreshStateFromForm()}>
            {modeValues}
          </Radio.Group>
        </Form.Item>

        {tableNameItem}
        {this.items()}
      </Form>
    );
  }

  public getCurrentConfig(): T {
    return this.state.currentValue;
  }

  public abstract items(): ReactNode;

  public refreshStateFromForm() {
    this.state.currentValue.update(this.props.form.getFieldsValue());
    this.forceUpdate();
  }
}

type IDestinationEditorModalProps = {
  config: DestinationConfig;
  onCancel: () => void;
  /**
   * @param connectionTestResult null if connection has been tested sucesfully, or error message test failed
   */
  onSave: (values: any, connectionTestResult: string) => void;
  testConnection: (values: any) => Promise<any>;
};

function DestinationsEditorModal({ config, onCancel, onSave, testConnection }: IDestinationEditorModalProps) {
  let configType = destinationsByTypeId[(config as DestinationConfig).type];
  const [saving, setSaving] = useState(false);

  const [connectionTesting, setConnectionTesting] = useState(false);

  let title = (
    <h1 className="destination-modal-header">
      {DestinationsList.getIcon((config as DestinationConfig).type)}Edit {configType.name} connection
    </h1>
  );
  const [form] = Form.useForm();
  return (
    <Modal
      closable={true}
      keyboard={true}
      maskClosable={true}
      width="70%"
      className="destinations-editor-modal"
      title={title}
      visible={true}
      onCancel={onCancel}
      footer={
        <>
          <Button
            className="destination-connection-test"
            loading={connectionTesting}
            onClick={async () => {
              setConnectionTesting(true);
              let values;
              try {
                values = await form.validateFields();
              } catch (e) {
                setConnectionTesting(false);
                //no need for special handling, error will be displayed within the field
                return;
              }
              try {
                await testConnection(values);
                message.success('Successfully connected!');
              } catch (error) {
                handleError(error, 'Failed to validate connection');
              } finally {
                setConnectionTesting(false);
              }
            }}
          >
            Test connection
          </Button>
          <Button onClick={onCancel}>Close</Button>
          <Button
            type="primary"
            loading={saving}
            onClick={async () => {
              setSaving(true);
              let values;
              try {
                values = await form.validateFields();
              } catch (error) {
                setSaving(false);
                //no need for special handling, error will be displayed within the field
                return;
              }
              let connectionError = null;
              try {
                connectionError = await testConnectionResult(async () => await testConnection(values));
                onSave(values, connectionError);
              } catch (error) {
                handleError(error, 'Failed to connect to destination. ' + error.message);
              } finally {
                setSaving(false);
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      {React.createElement(dialogsByType[configType.type], {
        initialConfigValue: config,
        form: form
      })}
    </Modal>
  );
}

/**
 * @return null if connection is ok, and error string if not
 */
async function testConnectionResult(tester: () => Promise<any>): Promise<string> {
  try {
    await tester();
    return null;
  } catch (e) {
    console.warn('Connection test failed', e);
    return e.message || 'Failed to connect';
  }
}

class ClickHouseDialog extends DestinationDialog<ClickHouseConfig> {
  isUrlValid(val) {
    let res = val.match(/((http(s)?|tcp):\/\/.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/g);
    return res != null;
  }

  items(): React.ReactNode {
    this.state.currentValue.migrateData();
    let dsnDocs = (
      <>
        A list of DSNs (server names). It's recommended to add at least two servers within the cluster for redundancy{' '}
        <a href="https://docs.eventnative.org/configuration-1/destination-configuration/clickhouse-destination#clickhouse)">
          documentation
        </a>
      </>
    );
    let clusterDoc = (
      <>
        <p>
          Cluster name. See{' '}
          <a href="https://docs.eventnative.org/configuration-1/destination-configuration/clickhouse-destination#clickhouse)">
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
        <a href="https://docs.eventnative.org/configuration-1/destination-configuration/clickhouse-destination#clickhouse)">
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
              label={<LabelWithTooltip documentation={dsnDocs}>Datasources</LabelWithTooltip>}
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
              <EditableList newItemLabel="Add new server" validator={dsnValidator} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          label={<LabelWithTooltip documentation={clusterDoc}>Cluster</LabelWithTooltip>}
          rules={[{ required: true, message: 'Cluster name is required' }]}
          name="ch_cluster"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
        >
          <Input type="text" />
        </Form.Item>
        <Form.Item
          label={<LabelWithTooltip documentation={databaseDoc}>Database</LabelWithTooltip>}
          rules={[{ required: true, message: 'DB is required' }]}
          name="ch_database"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
        >
          <Input type="text" />
        </Form.Item>
      </>
    );
  }
}

class PostgresDestinationDialog extends DestinationDialog<PostgresConfig> {
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
              <Input type="text" />
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
              <Input type="number" />
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
          <Input type="text" />
        </Form.Item>
        <Form.Item
          label="Database"
          name="pgdatabase"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'DB is required' }]}
        >
          <Input type="text" />
        </Form.Item>
        <Form.Item
          label="Username"
          name="pguser"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Username is required' }]}
        >
          <Input type="text" />
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
            iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
          />
        </Form.Item>
      </>
    );
  }
}

class GoogleAnalyticsDialog extends DestinationDialog<GoogleAnalyticsConfig> {
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
              <Input type="text" />
            </Form.Item>
          </Col>
        </Row>
      </>
    );
  }
}

class FacebookConversionDialog extends DestinationDialog<FacebookConversionConfig> {
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
        <a target="_blank" rel="noopener" href={'https://www.facebook.com/ads/manager/pixel/facebook_pixel/'}>
          create a new one
        </a>
        .
        <br />
        Read more about{' '}
        <a
          target="_blank"
          rel="noopener"
          href={'https://developers.facebook.com/docs/marketing-api/conversions-api/get-started#-------'}
        >
          Facebook conversion API
        </a>
      </>
    );
    let accessTokenDoc = (
      <>
        Your Facebook Access Token.
        <br />
        <a
          target="_blank"
          rel="noopener"
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
              label={<LabelWithTooltip documentation={pixelIdDoc}>Pixel ID</LabelWithTooltip>}
              name="fbPixelId"
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
              rules={[{ required: true, message: 'Pixel ID is required' }]}
            >
              <Input type="text" />
            </Form.Item>
            <Form.Item
              label={<LabelWithTooltip documentation={accessTokenDoc}>Access Token</LabelWithTooltip>}
              name="fbAccessToken"
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
              rules={[{ required: true, message: 'Access Token is required' }]}
            >
              <Input type="text" />
            </Form.Item>
          </Col>
        </Row>
      </>
    );
  }
}

class RedshiftDestinationDialog extends DestinationDialog<RedshiftConfig> {
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
              <Input type="text" />
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
          <Input type="text" />
        </Form.Item>
        <Form.Item
          label="Schema"
          name="redshiftSchema"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Schema is required' }]}
        >
          <Input type="text" />
        </Form.Item>
        <Form.Item
          label="Username"
          name="redshiftUser"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Username is required' }]}
        >
          <Input type="text" />
        </Form.Item>
        <Form.Item
          label="Password"
          name="redshiftPassword"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Password is required' }]}
        >
          <Input type="password" />
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

class SnowflakeDialog extends DestinationDialog<SnowflakeConfig> {
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
              <Input type="text" />
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
          <Input type="text" />
        </Form.Item>
        <Form.Item
          label="DB"
          name="snowflakeDB"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Field is required' }]}
        >
          <Input type="text" />
        </Form.Item>
        <Form.Item
          label="Schema"
          initialValue="public"
          name="snowflakeSchema"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Field is required' }]}
        >
          <Input type="text" />
        </Form.Item>
        <Form.Item
          label="Username"
          name="snowflakeUsername"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          rules={[{ required: true, message: 'Field is required' }]}
        >
          <Input type="text" />
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
            iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
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
          <Input type="text" />
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

class BiqQueryDialog extends DestinationDialog<BQConfig> {
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

function s3ConfigComponents(prefix: string, disabled: boolean) {
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
            <Input type="text" disabled={disabled} />
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
        <Input type="text" disabled={disabled} />
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
          iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
        />
      </Form.Item>
    </>
  );
}

function googleJsonKeyLabel() {
  return <LabelWithTooltip documentation={<>JSON access credentials</>}>Access Key</LabelWithTooltip>;
}

function gcsConfigComponents(prefix: string, disabled: boolean) {
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
        <Input type="text" disabled={disabled} />
      </Form.Item>
      <Form.Item
        className={className}
        label={googleJsonKeyLabel()}
        name={prefix + 'JSONKey'}
        labelCol={{ span: 4 }}
        wrapperCol={{ span: 12 }}
        rules={[{ required: !disabled, message: 'JSON Key is required' }]}
      >
        <Input.TextArea className="destinations-list-json-textarea" allowClear={true} bordered={true} />
      </Form.Item>
    </>
  );
}

const dialogsByType = {
  postgres: PostgresDestinationDialog,
  clickhouse: ClickHouseDialog,
  redshift: RedshiftDestinationDialog,
  snowflake: SnowflakeDialog,
  bigquery: BiqQueryDialog,
  google_analytics: GoogleAnalyticsDialog,
  facebook: FacebookConversionDialog
};
