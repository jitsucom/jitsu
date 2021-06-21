import { Collapse, Space, Switch } from 'antd';
import { CaretRightOutlined } from '@ant-design/icons';
// @DocsComponents
import { getCurlDocumentation, getEmbeddedHtml, getNPMDocumentation } from 'lib/commons/api-documentation';
// @Components
import { LabelWithTooltip } from '@component/LabelWithTooltip/LabelWithTooltip';
import {
  CodeInline,
  CodeSnippet
} from 'lib/components/components';

import styles from './OnboardingClientDocs.module.less';
import { useState } from 'react';

export type UserAPIToken = {
  uid: string;
  jsAuth: string;
  serverAuth: string;
  origins?: string[];
  comment?: string;
};

type Props = {
  token: UserAPIToken;
}

const DOCUMENTATION_DOMAIN = 'https://t.jitsu.com';

export const OnboardingClientDocs: React.FC<Props> = ({
  token
}) => {
  const [segmentEnabled, setSegmentEnabled] = useState<boolean>(false);

  const exampleSwitches = (
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
        <Switch size="small" checked={segmentEnabled} onChange={() => setSegmentEnabled(segmentEnabled => !segmentEnabled)}/>
      </Space>
    </div>
  );

  return (
    <div className={styles.container}>
      <Collapse
        style={{
          fontSize: '17px'
        }}
        bordered={false}
        defaultActiveKey={['1']}
        expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
        className={styles.onboardingDocsCustomCollapse}
      >
        <Collapse.Panel header="Embed in HTML" key="1" className="site-collapse-custom-panel">
          <p className="api-keys-documentation-tab-description">
          Easiest way to start tracking events within your web app is to add following snippet to{' '}
            <CodeInline>&lt;head&gt;</CodeInline> section of your html file:
          </p>
          <CodeSnippet size="small" language="html" extra={exampleSwitches}>
            {getEmbeddedHtml(segmentEnabled, token.jsAuth, DOCUMENTATION_DOMAIN)}
          </CodeSnippet>
        </Collapse.Panel>
        <Collapse.Panel header="Use NPM or YARN" key="2" className="site-collapse-custom-panel">
          <p className="api-keys-documentation-tab-description">
            <span className={styles.textBlock}>
          Use
            </span>
            <CodeSnippet size="small" language="bash">npm install --save @jitsu/sdk-js</CodeSnippet>
            <span className={styles.textBlock}>
          or
            </span>
            <CodeSnippet size="small" language="bash">yarn add @jitsu/sdk-js</CodeSnippet>
            <br/>
            <span className={styles.textBlock}>
          Then just follow this example:
            </span>
            <CodeSnippet size="small" language="javascript">{getNPMDocumentation(token.jsAuth, DOCUMENTATION_DOMAIN)}</CodeSnippet>
          </p>

          Read more about configuration properties{' '}<a href="https://jitsu.com/docs/sending-data/js-sdk/package">in documentation</a>.
        </Collapse.Panel>
        <Collapse.Panel header="Server to Server" key="3" className="site-collapse-custom-panel">
        Events can be send directly to API end-point. In that case, server secret should be used. Please, see curl
        example:
          <CodeSnippet size="small" language="bash">{getCurlDocumentation(token.serverAuth, DOCUMENTATION_DOMAIN)}</CodeSnippet>
        </Collapse.Panel>
      </Collapse>
    </div>

  );
}