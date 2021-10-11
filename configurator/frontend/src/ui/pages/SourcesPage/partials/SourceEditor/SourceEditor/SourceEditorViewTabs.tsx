import { Tabs } from 'antd';
// @Components
import { SourceEditorFormConfiguration } from './SourceEditorFormConfiguration';
import { SourceEditorFormStreams } from './SourceEditorFormStreams';
import { SourceEditorFormConnections } from './SourceEditorFormConnections';
// @Types
import {
  UpdateConfigurationFields,
  UpdateStreamsFields,
  UpdateConnectionsFields
} from './SourceEditor';

type SourceEditorTabsViewProps = {
  onConfigurationChange: UpdateConfigurationFields;
  onStreamsChange: UpdateStreamsFields;
  onConnectionsChange: UpdateConnectionsFields;
};

export const SourceEditorViewTabs: React.FC<SourceEditorTabsViewProps> = ({
  onConfigurationChange,
  onStreamsChange,
  onConnectionsChange
}) => {
  return (
    <Tabs defaultActiveKey="configuration">
      <Tabs.TabPane key="configuration">
        <SourceEditorFormConfiguration onChange={onConfigurationChange} />
      </Tabs.TabPane>
      <Tabs.TabPane key="streams">
        <SourceEditorFormStreams onChange={onStreamsChange} />
      </Tabs.TabPane>
      <Tabs.TabPane key="connections">
        <SourceEditorFormConnections onChange={onConnectionsChange} />
      </Tabs.TabPane>
    </Tabs>
  );
};
