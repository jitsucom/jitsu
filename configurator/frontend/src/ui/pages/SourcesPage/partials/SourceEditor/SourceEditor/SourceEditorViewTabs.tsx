import { Tabs } from 'antd';
import cn from 'classnames';
// @Components
import { SourceEditorFormConfiguration } from './SourceEditorFormConfiguration';
import { SourceEditorFormStreams } from './SourceEditorFormStreams';
import { SourceEditorFormConnections } from './SourceEditorFormConnections';
// @Types
import { SourceConnector as CatalogSourceConnector } from 'catalog/sources/types';
import {
  UpdateConfigurationFields,
  UpdateStreamsFields,
  UpdateConnectionsFields
} from './SourceEditor';
import { SourceEditorViewControls } from './SourceEditorViewControls';

type SourceEditorTabsViewProps = {
  initialSourceDataFromBackend: Optional<SourceData>;
  sourceDataFromCatalog: CatalogSourceConnector;
  onConfigurationChange: UpdateConfigurationFields;
  onStreamsChange: UpdateStreamsFields;
  onConnectionsChange: UpdateConnectionsFields;
  handleLeaveEditor: VoidFunction;
};

export const SourceEditorViewTabs: React.FC<SourceEditorTabsViewProps> = ({
  initialSourceDataFromBackend,
  sourceDataFromCatalog,
  onConfigurationChange,
  onStreamsChange,
  onConnectionsChange,
  handleLeaveEditor
}) => {
  return (
    <>
      <div className={cn('flex flex-col items-stretch flex-auto')}>
        <div className={cn('flex-grow')}>
          <Tabs defaultActiveKey="configuration">
            <Tabs.TabPane key="configuration">
              <SourceEditorFormConfiguration
                initialSourceDataFromBackend={initialSourceDataFromBackend}
                sourceDataFromCatalog={sourceDataFromCatalog}
                onChange={onConfigurationChange}
              />
            </Tabs.TabPane>
            <Tabs.TabPane key="streams">
              <SourceEditorFormStreams onChange={onStreamsChange} />
            </Tabs.TabPane>
            <Tabs.TabPane key="connections">
              <SourceEditorFormConnections onChange={onConnectionsChange} />
            </Tabs.TabPane>
          </Tabs>
        </div>

        <div className="flex-shrink border-t pt-2">
          <SourceEditorViewControls
            saveButton={{
              handleClick: () => {}
            }}
            handleCancel={handleLeaveEditor}
          />
        </div>
      </div>
    </>
  );
};
