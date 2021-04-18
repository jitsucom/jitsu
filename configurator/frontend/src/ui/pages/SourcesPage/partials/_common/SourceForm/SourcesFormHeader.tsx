import { SourcesFormHeaderProps } from '../SourceForm/SourceForm.types';
import styles from './SourcesFormHeader.module.less';
import classNames from 'classnames';

export const SourceFormHeader: React.FC<SourcesFormHeaderProps> = ({ connectorSource , mode }) => {
  return <div className="flex flex-row items-center space-x-1 text-text">
    <div className={classNames(styles.connectorPic, '')}>{connectorSource.pic}</div>
    <div className="">{connectorSource.displayName} ({mode === 'add' ? 'add new' : 'edit'})</div>
  </div>
}

export default SourceFormHeader;