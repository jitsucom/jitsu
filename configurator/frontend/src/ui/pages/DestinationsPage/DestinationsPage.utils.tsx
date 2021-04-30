// @Libs
import { message, Popover } from 'antd';
// @Components
import { ListItemTitle } from '@atom/ListItemTitle';
import { LabelWithTooltip } from '@atom/LabelWithTooltip';
import { ListItemDescription } from '@atom/ListItemDescription';
import { ActionLink, Align, CodeInline, CodeSnippet } from '@./lib/components/components';
// @Types
import { Destination } from '@catalog/destinations/types';
// @Utils
import { copyToClipboard } from '@./lib/commons/utils';

const destinationsUtils = {
  getTitle: (dst: DestinationData) => {
    const configTitle = <ListItemTitle
      error={!dst._connectionTestOk}
      errorMessage={
        dst._connectionErrorMessage && <>
          Last connection test failed with <b><i>'{dst._connectionErrorMessage}'</i></b>. Destination might be not
          accepting data. Please, go to editor and fix the connection settings
        </>
      }
      render={dst._id}
    />;

    return dst._comment
      ? <LabelWithTooltip documentation={dst._comment} render={configTitle} />
      : configTitle;
  },
  getDescription: (reference: Destination, dst: DestinationData) => {
    const { title, connectCmd } = reference.ui;

    const commandLineConnect = typeof connectCmd === 'function' ? connectCmd(dst) : undefined;
    const displayURL = typeof title === 'function' ? title(dst) : undefined;

    if (!commandLineConnect) {
      return <ListItemDescription render={displayURL} />;
    }

    const codeSnippet = commandLineConnect.indexOf('\n') < 0
      ? <>
        <div>
          <CodeInline>{commandLineConnect}</CodeInline>
        </div>
        <Align horizontal="right">
          <ActionLink
            onClick={() => {
              copyToClipboard(commandLineConnect);
              message.info('Command copied to clipboard', 2);
            }}>
            Copy command to clipboard
          </ActionLink>
        </Align>
      </>
      : <CodeSnippet className="destinations-list-multiline-code" language="bash">
        {commandLineConnect}
      </CodeSnippet>;

    return <Popover
      placement="topLeft"
      content={
        <>
          <h4><b>Use following command to connect to DB and run a test query:</b></h4>
          {codeSnippet}
        </>
      }
      trigger="click">
      <ListItemDescription render={displayURL} dotted />
    </Popover>;
  },
  getMode: (mode: string) => mode ? <ListItemDescription render={<>mode: {mode}</>} /> : undefined
};

export {
  destinationsUtils
}
