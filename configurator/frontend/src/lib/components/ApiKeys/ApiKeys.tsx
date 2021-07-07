/* eslint-disable */
import React, { ReactElement, useState } from 'react';
import { Button, Input, message, Modal, Select, Space, Switch, Table, Tabs, Tooltip } from 'antd';
import ApplicationServices from '../../services/ApplicationServices';

import CodeFilled from '@ant-design/icons/lib/icons/CodeFilled';
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';

import './ApiKeys.less';
import {
  ActionLink,
  CenteredError,
  CenteredSpin,
  CodeInline,
  CodeSnippet,
  handleError,
  LoadableComponent
} from '../components';
import { copyToClipboard } from '../../commons/utils';
import TagsInput from '../TagsInput/TagsInput';
import { getCurlDocumentation, getEmbeddedHtml, getNPMDocumentation } from '../../commons/api-documentation';
import DeleteFilled from '@ant-design/icons/lib/icons/DeleteFilled';
import ExclamationCircleOutlined from '@ant-design/icons/lib/icons/ExclamationCircleOutlined';
import { LabelWithTooltip } from 'ui/components/LabelWithTooltip/LabelWithTooltip';
import useLoader from 'hooks/useLoader';
import { randomId } from 'utils/numbers';
import { useServices } from 'hooks/useServices';

export type UserAPIToken = {
  uid: string;
  jsAuth: string;
  serverAuth: string;
  origins?: string[];
  comment?: string;
};

type TokensBackendResponse = {
  keys?: UserAPIToken[]; 
}

type LoadingEntity = number | 'NEW' | null;
type State = {
  loading: LoadingEntity; //what's displayed as loading? number - index of key, "NEW" - new button, null - nothing
  tokens: UserAPIToken[];
};

function generateNewKeyWithConfirmation(onConfirm: () => void) {
  Modal.confirm({
    title: 'Please confirm deletion of destination',
    icon: <ExclamationCircleOutlined/>,
    content: 'Are you sure you want to delete generate new key? Previously generated key will be lost and you\'ll need to reconfigure ALL clients',
    okText: 'Generate new key',
    cancelText: 'Cancel',
    onOk: onConfirm,
    onCancel: () => {
    }
  });
}

export function generateNewAPIToken(type: string, len?: number): string {
  const postfix = `${ApplicationServices.get().activeProject.id}.${randomId(len)}`;
  return type.length > 0 ?
    `${type}.${postfix}` :
    postfix;
}

export async function fetchUserAPITokens(): Promise<TokensBackendResponse | never> {
  const services = ApplicationServices.get();
  return services.storageService.get('api_keys', services.activeProject.id)
}
/**
 * WARNING - this function will re-write all data stored on the backend. 
 * It is safe to use only if you have merged the previous state in the request.
 * @param newTokens - Tokens to put to server
 * @returns Empty promise
 */
export async function _unsafeRequestPutUserAPITokens(newTokens: UserAPIToken[]): Promise<void | never> {
  const services = ApplicationServices.get();
  return services.storageService.save('api_keys', { keys: newTokens }, services.activeProject.id);
}

export async function requestAddNewUserAPIToken(newToken: UserAPIToken): Promise<void | never> {
  const services = ApplicationServices.get();
  const prevState = (await fetchUserAPITokens()).keys;
  const newState = prevState ? [...prevState, newToken] : [newToken];
  return services.storageService.save('api_keys', { keys: newState }, services.activeProject.id);
}

export default class ApiKeys extends LoadableComponent<{}, State> {
  private readonly services: ApplicationServices;

  constructor(props: any, context: any) {
    super(props, context);
    this.services = ApplicationServices.get();
    this.state = {
      loading: null,
      tokens: []
    };
  }

  protected async load(): Promise<State> {
    let payload = await fetchUserAPITokens();
    return {
      tokens: payload && payload.keys 
          ? payload.keys 
          : [], 
      loading: null
    };
  }

  protected renderReady() {
    let header = <div className="flex flex-row mb-5 items-start">
      <div>{(
        <Button
          type="primary"
          size="large"
          icon={<PlusOutlined/>}
          loading={'NEW' === this.state.loading}
          onClick={async() => {
            let newToken = {
              uid: generateNewAPIToken('', 6),
              serverAuth: generateNewAPIToken('s2s'),
              jsAuth: generateNewAPIToken('js'),
              origins: []
            };
            let newTokens = [...this.state.tokens, newToken];
            await this.saveTokens(newTokens, 'NEW');
            const tokenSuccessfullySaved = this.state.tokens.find(
              token => token.uid === newToken.uid
            )
            tokenSuccessfullySaved && message.info('New API key has been saved!');
          }}
        >
          Generate New Key
        </Button>
      )}</div>
      <div className="text-secondaryText text-sm ml-4">
        Generate API key to start sending events from your app or website. You can embed tracking code right into you website, use
        npm package within your webapp. <br/>Once key is generated, check out embedding instructions for each key
      </div>
    </div>

    const editNote = async(rowIndex, val?) => {
      let note = prompt('Enter key description (set to empty to delete)', val || '');
      if (note !== null && note !== undefined) {
        this.state.tokens[rowIndex].comment = note === '' ? undefined : note;
        await this.saveTokens(this.state.tokens, rowIndex);
      }
    }

    const columns = [
      {
        width: '250px',
        className: 'api-keys-column-id',
        dataIndex: 'uid',
        key: 'uid',
        render: (text, row: UserAPIToken, index) => {
          return (
            <>
              <span className="font-mono text-sm">{text}</span>
              {row.comment ?
                (
                  <div className="text-secondaryText">
                    <b>Note</b>: {row.comment} (<a onClick={async () => editNote(index, row.comment)}>edit</a>)
                  </div>
                ) :
                (<><div>(<a onClick={async () => editNote(index)}>add note</a>)</div></>)}
            </>
          );
        },
        title: <LabelWithTooltip documentation={'Unique ID of the key'} render="ID"/>
      },
      {
        width: '250px',
        className: 'api-keys-column-js-auth',
        dataIndex: 'jsAuth',
        key: 'jsAuth',
        render: (text, row, index) => {
          return (
            <span>
              <Input className={'api-keys-key-input'} type="text" value={text}/>
              <Space>
                <ActionLink onClick={() => this.copyToClipboard(text)}>Copy To Clipboard</ActionLink>
                <ActionLink
                  onClick={() => {
                    generateNewKeyWithConfirmation(() => {
                      this.state.tokens[index].jsAuth = generateNewAPIToken('js');
                      this.saveTokens(this.state.tokens, index);
                      message.info('New key has been generated and saved');
                    })
                  }}
                >
                  Generate New Key
                </ActionLink>
              </Space>
            </span>
          );
        },
        title: (
          <LabelWithTooltip
            documentation={
              <>
                Client API Key. Should be used with{' '}
                <a href="https://jitsu.com/docs/sending-data/javascript-reference">JS client</a>.
              </>
            }
            render="Client Secret"
          />
        )
      },
      {
        width: '250px',
        className: 'api-keys-column-s2s-auth',
        dataIndex: 'serverAuth',
        key: 'serverAuth',
        render: (text, row, index) => {
          return (
            <span>
              <Input className="api-keys-key-input" type="text" value={text}/>
              <Space>
                <ActionLink onClick={() => this.copyToClipboard(text)}>Copy To Clipboard</ActionLink>
                <ActionLink
                  onClick={() => {
                    generateNewKeyWithConfirmation(() => {
                      this.state.tokens[index].serverAuth = generateNewAPIToken('s2s');
                      this.saveTokens(this.state.tokens, index);
                      message.info('New key has been generated and saved');
                    })
                  }}
                >
                  Generate New Key
                </ActionLink>
              </Space>
            </span>
          );
        },
        title: (
          <LabelWithTooltip
            documentation={
              <>
                Server API Key. Should be used with <a href="https://docs.eventnative.org/api">backend API calls</a>.
              </>
            }
            render="Server Secret"
          />
        )
      },
      {
        className: 'api-keys-column-origins',
        dataIndex: 'origins',
        key: 'origins',
        render: (text, row, index) => {
          return (
            <span>
              <TagsInput
                newButtonText="Add Origin"
                value={this.state.tokens[index].origins}
                onChange={(value) => {
                  this.state.tokens[index].origins = [...value];
                  this.saveTokens(this.state.tokens, index);
                  message.info('New origin has been added and saved');
                }}
              />
            </span>
          );
        },
        title: (
          <LabelWithTooltip
            documentation={
              <>
                JavaScript origins. If set, only calls from those hosts will be accepted. Wildcards are supported as
                (*.abc.com). If you want to whitelist domain abc.com and all subdomains, add abc.com and *.abc.com. If
                list is empty, traffic will be accepted from all domains
              </>
            }
            render="Origins"
          />
        )
      },
      {
        width: '140px',
        className: 'api-keys-column-actions',
        title: 'Actions',
        dataIndex: 'actions',
        render: (text, row: UserAPIToken, index) => {
          return (
            <>
              <Tooltip trigger={['hover']} title={'Show integration documentation'}>
                <a
                  onClick={async() => {
                    Modal.info({
                      content: <KeyDocumentation token={row}/>,
                      title: null,
                      icon: null,
                      className: 'api-keys-documentation-modal'
                    });
                  }}
                >
                  <CodeFilled/>
                </a>
              </Tooltip>
              <Tooltip trigger={['hover']} title="Delete key">
                <a
                  onClick={() => {
                    Modal.confirm({
                      title: 'Are you sure?',
                      content: 'Key will be deleted completely. There will be no way to restore it!',
                      onOk: () => {
                        let newTokens = [...this.state.tokens];
                        newTokens.splice(index, 1);
                        this.saveTokens(newTokens, index);
                      },
                      onCancel: () => {
                      }
                    });
                  }}
                >
                  <DeleteFilled/>
                </a>
              </Tooltip>
            </>
          );
        }
      }
    ];
    return (
      <>
        {header}
        <Table
          pagination={false}
          className="api-keys-table"
          columns={columns}
          dataSource={this.state.tokens.map((t) => {
            return { ...t, key: t.uid };
          })}
        />
      </>
    );
  }

  private static keys(nodes: ReactElement[]): ReactElement[] {
    nodes.forEach((node, idx) => (node.key = idx));
    return nodes;
  }

  private async saveTokens(newTokens: UserAPIToken[], loading: LoadingEntity) {
    this.setState({
      loading: loading
    });
    try {
      await _unsafeRequestPutUserAPITokens(newTokens);
      this.setState({ tokens: newTokens });
    } catch (e) {
      message.error('Can\'t generate new token: ' + e.message);
      console.log(e);
    } finally {
      this.setState({loading: null});
    }
  }

  copyToClipboard(value) {
    copyToClipboard(value);
    message.success('Key copied to clipboard');
  }
}

function getDomainsSelection(env: string) {
  return env === 'heroku' ? [location.protocol + '//' + location.host] : []
}

type KeyDocumentationProps = {
  token: UserAPIToken;
  displayDomainDropdown?: boolean;
}

export const KeyDocumentation: React.FC<KeyDocumentationProps> = function({ 
  token,
  displayDomainDropdown = true 
}) {
  const [segment, setSegmentEnabled] = useState(false);
  const services = useServices();
  const staticDomains = getDomainsSelection(services.features.environment);
  console.log(`As per ${services.features.environment} available static domains are: ` + staticDomains)
  const [selectedDomain, setSelectedDomain] = useState(staticDomains.length > 0 ? staticDomains[0] : null);
  const [error, domains] = services.features.enableCustomDomains ?
    useLoader(async() => {
      let result = await services.storageService.get('custom_domains', services.activeProject.id);
      let customDomains = result && result.domains ?
        result.domains.map((domain) => "https://" + domain.name) :
        [];
      let newDomains = [...customDomains, 'https://t.jitsu.com'];
      setSelectedDomain(newDomains[0]);
      return newDomains;
    }) :
    [null, staticDomains];

  if (error) {
    handleError(error, 'Failed to load data from server');
    return <CenteredError error={error}/>;
  } else if (!domains) {
    return <CenteredSpin/>;
  }
  console.log(`Currently selected domain is: ${selectedDomain}`)

  let exampleSwitches = (
    <div className="api-keys-doc-embed-switches">
      <Space>
        <LabelWithTooltip
          documentation={
            <>
              Check if you want to intercept events from Segment (
              <a href="https://jitsu.com/docs/sending-data/js-sdk/snippet#intercepting-segment-events">Read more</a>)
            </>
          }
          render="Intercept Segment events"
        />
        <Switch size="small" checked={segment} onChange={() => setSegmentEnabled(!segment)}/>
      </Space>
    </div>
  );

  const documentationDomain = selectedDomain || services.features.jitsuBaseUrl || 'REPLACE_WITH_JITSU_DOMAIN';
  return (
    <Tabs
      className="api-keys-documentation-tabs"
      defaultActiveKey="1"
      tabBarExtraContent={
        <>
          {domains.length > 0 && displayDomainDropdown && 
            <>
              <LabelWithTooltip documentation="Domain" render="Domain"/>:{' '}
              <Select defaultValue={domains[0]} onChange={(value) => setSelectedDomain(value)}>
                {domains.map((domain) => {
                  return <Select.Option value={domain}>{domain}</Select.Option>;
                })}
              </Select>
            </>
          }
        </>
      }
    >
      <Tabs.TabPane tab="Embed JavaScript" key="1">
        <p className="api-keys-documentation-tab-description">
          Easiest way to start tracking events within your web app is to add following snippet to{' '}
          <CodeInline>&lt;head&gt;</CodeInline> section of your html file.{' '}
          <a href="https://jitsu.com/docs/sending-data/js-sdk/">Read more</a> about JavaScript integration on our
          documentation website
        </p>
        <CodeSnippet language="html" extra={exampleSwitches}>
          {getEmbeddedHtml(segment, token.jsAuth, documentationDomain)}
        </CodeSnippet>
      </Tabs.TabPane>
      <Tabs.TabPane tab="Use NPM/YARN" key="2">
        <p className="api-keys-documentation-tab-description">
          Use <CodeInline>npm install --save @jitsu/sdk-js</CodeInline> or{' '}
          <CodeInline>yarn add @jitsu/sdk-js</CodeInline>. Read more{' '}
          <a href="https://jitsu.com/docs/sending-data/js-sdk/package">about configuration properties</a>
        </p>
        <CodeSnippet language="javascript">{getNPMDocumentation(token.jsAuth, documentationDomain)}</CodeSnippet>
      </Tabs.TabPane>
      <Tabs.TabPane tab="Server to server" key="3">
        Events can be send directly to API end-point. In that case, server secret should be used. Please, see curl
        example:
        <CodeSnippet language="bash">{getCurlDocumentation(token.serverAuth, documentationDomain)}</CodeSnippet>
      </Tabs.TabPane>
    </Tabs>
  );
}
