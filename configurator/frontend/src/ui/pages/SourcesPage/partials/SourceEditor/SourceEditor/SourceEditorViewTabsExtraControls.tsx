import { SourceConnector } from 'catalog/sources/types';
import { generatePath, NavLink } from 'react-router-dom';
import { taskLogsPageRoute } from 'ui/pages/TaskLogs/TaskLogsPage';

type Props = {
  sourceId: string;
  sourceDataFromCatalog: SourceConnector;
  showLogsButton?: boolean;
  setDocumentationVisible: (value: boolean) => void;
};

export const SourceEditorViewTabsExtraControls: React.FC<Props> = ({
  sourceId,
  sourceDataFromCatalog,
  showLogsButton,
  setDocumentationVisible
}) => {
  return (
    <span className="uppercase">
      {showLogsButton && (
        <NavLink
          to={generatePath(taskLogsPageRoute, {
            sourceId: sourceId ?? sourceDataFromCatalog.id ?? 'not_found'
          })}
        >
          View Logs
        </NavLink>
      )}
      {showLogsButton && sourceDataFromCatalog?.documentation && (
        <>
          {' '}
          <span className="text-link text-xl">•</span>{' '}
        </>
      )}
      {sourceDataFromCatalog?.documentation && (
        <>
          <a onClick={() => setDocumentationVisible(true)}>Documentation</a>
        </>
      )}
    </span>
  );
};
