// @Libs
import React, { useState } from 'react';
import { flowResult } from 'mobx';
import { Observer, observer } from 'mobx-react-lite';
import {
  Button, Drawer,
  Input,
  message,
  Modal, Popover,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tooltip
} from 'antd';
// @Components
import {
  ActionLink,
  CenteredError,
  CenteredSpin,
  CodeInline,
  CodeSnippet,
  handleError
} from '../components';
import {
  getCurlDocumentation,
  getEmbeddedHtml,
  getNPMDocumentation
} from '../../commons/api-documentation';
import TagsInput from '../TagsInput/TagsInput';
import { LabelWithTooltip } from 'ui/components/LabelWithTooltip/LabelWithTooltip';
// @Store
import { apiKeysStore, UserApiKey } from 'stores/apiKeys';
// @Services
import { useServices } from 'hooks/useServices';
// @Icons
import CodeFilled from '@ant-design/icons/lib/icons/CodeFilled';
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';
import DeleteFilled from '@ant-design/icons/lib/icons/DeleteFilled';
import ExclamationCircleOutlined from '@ant-design/icons/lib/icons/ExclamationCircleOutlined';
// @Utils
import { copyToClipboard as copyToClipboardUtility } from '../../commons/utils';
// @Hooks
import useLoader from 'hooks/useLoader';
// @Styles
import './ApiKeys.less';
import { default as JitsuClientLibraryCard, jitsuClientLibraries } from '../JitsuClientLibrary/JitsuClientLibrary';
import { Code } from '../Code/Code';

/**
 * What's displayed as loading?
 * - number - index of key,
 * - "NEW" - new button,
 * - null - nothing
 */
type LoadingState =
  | number
  | 'NEW'
  | null;

function generateNewKeyWithConfirmation(onConfirm: () => void) {
  Modal.confirm({
    title: 'Please confirm deletion of destination',
    icon: <ExclamationCircleOutlined />,
    content:
      "Are you sure you want to delete generate new key? Previously generated key will be lost and you'll need to reconfigure ALL clients",
    okText: 'Generate new key',
    cancelText: 'Cancel',
    onOk: onConfirm,
    onCancel: () => {}
  });
}

const ApiKeysComponent: React.FC = () => {

  const keys = apiKeysStore.apiKeys;

  const [loading, setLoading] = useState<LoadingState>(null);
  const [documentationDrawerKey, setDocumentationDrawerKey] = useState<UserApiKey>(null);

  const handleDeleteKey = (key: UserApiKey): Promise<void> => {
    return flowResult(apiKeysStore.deleteApiKey(key));
  }

  const handleEditKeys = async(newKeys: UserApiKey | UserApiKey[], loading: LoadingState) => {
    setLoading(loading);
    try {
      await flowResult(apiKeysStore.editApiKeys(newKeys));
    } catch (e) {
      message.error("Can't generate new token: " + e.message);
      console.log(e);
    } finally {
      setLoading(null);
    }
  }

  const copyToClipboard = (value) => {
    copyToClipboardUtility(value);
    message.success('Key copied to clipboard');
  }

  const editNote = async(rowIndex, val?) => {
    let note = prompt(
      'Enter key description (set to empty to delete)',
      val || ''
    );
    if (note !== null && note !== undefined) {
      const updatedKey = { ...keys[rowIndex] }
      updatedKey.comment = note === '' ? undefined : note;
      await handleEditKeys(updatedKey, rowIndex);
    }
  };

  const header = (
    <div className="flex flex-row mb-5 items-start justify between">
      <div className="flex-grow flex text-secondaryText">
        Jitsu supports many <Popover trigger="click" placement="bottom" title={null} content={<div className="w-96 flex-wrap flex justify-center">
          {Object.values(jitsuClientLibraries).map(props => <div className="mx-3 my-4" key={props.name}><JitsuClientLibraryCard {...props}  /></div>)}
        </div>}>{'\u00A0'}<a>languages and frameworks</a>{'\u00A0'}</Popover>!

      </div>
      <div className="flex-shrink">
        <Button
          type="primary"
          size="large"
          icon={<PlusOutlined />}
          loading={'NEW' === loading}
          onClick={async() => {
            setLoading( 'NEW' );
            try {
              await flowResult(apiKeysStore.generateAddApiKey());
              message.info('New Api key has been saved!');
            } catch (error) {
              message.error(`Failed to add new token: ${error.message || error}`)
            } finally {
              setLoading( null );
            }
          }}
        >Generate New Key</Button>
      </div>
    </div>
  );

  const columns = [
    {
      width: '250px',
      className: 'api-keys-column-id',
      dataIndex: 'uid',
      key: 'uid',
      render: (text, row: UserApiKey, index) => {
        return (
          <>
            <span className="font-mono text-sm">{text}</span>
            {row.comment ? (
              <div className="text-secondaryText">
                <b>Note</b>: {row.comment} (
                <a onClick={async() => editNote(index, row.comment)}>edit</a>
                )
              </div>
            ) : (
              <>
                <div>
                  (<a onClick={async() => editNote(index)}>add note</a>)
                </div>
              </>
            )}
          </>
        );
      },
      title: (
        <LabelWithTooltip
          documentation={'Unique ID of the key'}
          render="ID"
        />
      )
    },
    {
      width: '250px',
      className: 'api-keys-column-js-auth',
      dataIndex: 'jsAuth',
      key: 'jsAuth',
      render: (text, row, index) => {
        return (
          <span>
            <Input
              className={'api-keys-key-input'}
              type="text"
              value={text}
            />
            <Space>
              <ActionLink onClick={() => copyToClipboard(text)}>
                Copy To Clipboard
              </ActionLink>
              <Observer>
                {() => (
                  <ActionLink
                    onClick={() => {
                      generateNewKeyWithConfirmation(() => {
                        const updatedKey = { ...keys[index] };
                        updatedKey.jsAuth =
                        apiKeysStore.generateApiToken('js');
                        handleEditKeys(updatedKey, index);
                        message.info('New key has been generated and saved');
                      });
                    }}
                  >
                  Generate New Key
                  </ActionLink>
                )}
              </Observer>
            </Space>
          </span>
        );
      },
      title: (
        <LabelWithTooltip
          documentation={
            <>
              Client Api Key. Should be used with{' '}
              <a href="https://jitsu.com/docs/sending-data/javascript-reference">
                JS client
              </a>
              .
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
            <Input className="api-keys-key-input" type="text" value={text} />
            <Space>
              <ActionLink onClick={() => copyToClipboard(text)}>
                Copy To Clipboard
              </ActionLink>
              <Observer>
                {() => (
                  <ActionLink
                    onClick={() => {
                      generateNewKeyWithConfirmation(() => {
                        const updatedKey = { ...keys[index] };
                        updatedKey.serverAuth =
                        apiKeysStore.generateApiToken('s2s');
                        handleEditKeys(updatedKey, index);
                        message.info('New key has been generated and saved');
                      });
                    }}
                  >
                  Generate New Key
                  </ActionLink>
                )}
              </Observer>
            </Space>
          </span>
        );
      },
      title: (
        <LabelWithTooltip
          documentation={
            <>
              Server Api Key. Should be used with{' '}
              <a href="https://docs.eventnative.org/api">backend Api calls</a>
              .
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
              value={keys[index].origins}
              onChange={(value) => {
                const updatedKey = { ...keys[index] };
                updatedKey.origins = [...value];
                handleEditKeys(updatedKey, index);
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
              JavaScript origins. If set, only calls from those hosts will be
              accepted. Wildcards are supported as (*.abc.com). If you want to
              whitelist domain abc.com and all subdomains, add abc.com and
              *.abc.com. If list is empty, traffic will be accepted from all
              domains
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
      render: (text, row: UserApiKey, index) => {
        return (
          <>
            <Tooltip
              trigger={['hover']}
              title={'Show integration documentation'}
            >
              <a onClick={() => setDocumentationDrawerKey(row)}><CodeFilled /></a>
            </Tooltip>
            <Tooltip trigger={['hover']} title="Delete key">
              <a
                onClick={() => {
                  Modal.confirm({
                    title: 'Are you sure?',
                    content:
                      'Key will be deleted completely. There will be no way to restore it!',
                    onOk: () => handleDeleteKey(keys[index]),
                    onCancel: () => {}
                  });
                }}
              >
                <DeleteFilled />
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
        dataSource={keys.map((t) => {
          return { ...t, key: t.uid };
        })}
      />
      <Drawer width="70%" visible={!!documentationDrawerKey} onClose={() => setDocumentationDrawerKey(null)}>
        {documentationDrawerKey && <KeyDocumentation token={documentationDrawerKey} />}
      </Drawer>
    </>
  );

}

export function getDomainsSelectionByEnv(env: string) {
  return env === 'heroku' ? [location.protocol + '//' + location.host] : [];
}

type KeyDocumentationProps = {
  token: UserApiKey;
  displayDomainDropdown?: boolean;
};

export const KeyDocumentation: React.FC<KeyDocumentationProps> = function({
  token,
  displayDomainDropdown = true
}) {
  const [segment, setSegmentEnabled] = useState<boolean>(false);
  const services = useServices();
  const staticDomains = getDomainsSelectionByEnv(services.features.environment);
  console.log(
    `As per ${services.features.environment} available static domains are: ` +
      staticDomains
  );
  const [selectedDomain, setSelectedDomain] = useState<string | null>(
    staticDomains.length > 0 ? staticDomains[0] : null
  );
  const [error, domains] = services.features.enableCustomDomains
    ? useLoader(async() => {
      const result = await services.storageService.get(
        'custom_domains',
        services.activeProject.id
      );
      const customDomains =
          result?.domains?.map((domain) => 'https://' + domain.name)
          || [];
      const newDomains = [...customDomains, 'https://t.jitsu.com'];
      setSelectedDomain(newDomains[0]);
      return newDomains;
    })
    : [null, staticDomains];

  if (error) {
    handleError(error, 'Failed to load data from server');
    return <CenteredError error={error} />;
  } else if (!domains) {
    return <CenteredSpin />;
  }
  console.log(`Currently selected domain is: ${selectedDomain}`);

  const exampleSwitches = (
    <div className="api-keys-doc-embed-switches">
      <Space>
        <LabelWithTooltip
          documentation={
            <>
              Check if you want to intercept events from Segment (
              <a href="https://jitsu.com/docs/sending-data/js-sdk/snippet#intercepting-segment-events">
                Read more
              </a>
              )
            </>
          }
          render="Intercept Segment events"
        />
        <Switch
          size="small"
          checked={segment}
          onChange={() => setSegmentEnabled(!segment)}
        />
      </Space>
    </div>
  );

  const documentationDomain =
    selectedDomain ||
    services.features.jitsuBaseUrl ||
    'REPLACE_WITH_JITSU_DOMAIN';
  return (
    <Tabs
      className="api-keys-documentation-tabs pt-8"
      defaultActiveKey="1"
      tabBarExtraContent={
        <>
          {domains.length > 0 && displayDomainDropdown && (
            <>
              <LabelWithTooltip documentation="Domain" render="Domain" />:{' '}
              <Select
                defaultValue={domains[0]}
                onChange={(value) => setSelectedDomain(value)}
              >
                {domains.map((domain) => {
                  return <Select.Option value={domain}>{domain.replace('https://', '')}</Select.Option>;
                })}
              </Select>
            </>
          )}
        </>
      }
    >
      <Tabs.TabPane tab="Embed JavaScript" key="1">
        <p className="api-keys-documentation-tab-description">
          Easiest way to start tracking events within your web app is to add
          following snippet to <CodeInline>&lt;head&gt;</CodeInline> section of
          your html file.{' '}
          <a href="https://jitsu.com/docs/sending-data/js-sdk/">Read more</a>{' '}
          about JavaScript integration on our documentation website
        </p>
        <Code className="bg-bgSecondary py-3 px-5 rounded-xl mb-2" language="html">
          {getEmbeddedHtml(segment, token.jsAuth, documentationDomain)}
        </Code>
        {exampleSwitches}
      </Tabs.TabPane>
      <Tabs.TabPane tab="Use NPM/YARN" key="2">
        <p className="api-keys-documentation-tab-description">
          Use <CodeInline>npm install --save @jitsu/sdk-js</CodeInline> or{' '}
          <CodeInline>yarn add @jitsu/sdk-js</CodeInline>. Read more{' '}
          <a href="https://jitsu.com/docs/sending-data/js-sdk/package">
            about configuration properties
          </a>
        </p>
        <Code className="bg-bgSecondary py-3 px-5 rounded-xl mb-2" language="javascript">
          {getNPMDocumentation(token.jsAuth, documentationDomain)}
        </Code>
      </Tabs.TabPane>
      <Tabs.TabPane tab="Server to server" key="3">
        <p className="api-keys-documentation-tab-description">
        Events can be send directly to Api end-point. In that case, server
        secret should be used. Please, see curl example:
        </p>
        <Code className="bg-bgSecondary py-3 px-5  rounded-xl mb-2" language="bash">
          {getCurlDocumentation(token.serverAuth, documentationDomain)}
        </Code>
      </Tabs.TabPane>
    </Tabs>
  );
};

const ApiKeys = observer(ApiKeysComponent);

ApiKeys.displayName = 'ApiKeys';

export default ApiKeys;