import { SourcesFormHeaderProps } from '../SourceForm/SourceForm.types';
import { NavLink } from 'react-router-dom';
import { routes } from '../../../routes';
import styles from './SourcesFormHeader.module.less';

export const SourceFormHeader: React.FC<SourcesFormHeaderProps> = ({ connectorSource }) => {
  return <div className="flex flex-row items-center"><h2 className="add-source__head-base">
    <NavLink to={routes.root} className="add-source__head-base-link">Sources</NavLink>
    <span>/</span>
  </h2>
  <div className={styles.connectorPic}>{connectorSource.pic}</div>
  <div className="add-source__head-text">
    <h2 className="add-source__head-text-title">{connectorSource.displayName}</h2>
  </div></div>
}

export default SourceFormHeader;