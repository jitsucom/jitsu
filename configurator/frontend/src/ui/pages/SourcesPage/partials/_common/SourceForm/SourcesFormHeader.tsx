import { SourcesFormHeaderProps } from '../SourceForm/SourceForm.types';
import styles from './SourcesFormHeader.module.less';
import classNames from 'classnames';

export const SourceFormHeader: React.FC<SourcesFormHeaderProps> = ({ connectorSource }) => {
  return <div className="flex flex-row items-center space-x-1 text-text">
    <div className={classNames(styles.connectorPic, '')}>{connectorSource.pic}</div>
    <div className="">{connectorSource.displayName}</div>
  </div>
}

export default SourceFormHeader;