// @Libs
import { Button, Modal } from 'antd';
// @Catalog
import mappings from '@catalog/mappings/lib';
// @Styles
import styles from './DestinationEditor.module.less';
// @Types
import { FormInstance } from 'antd/es';
import { FieldMapping, Mapping } from '@catalog/mappings/types';
// @Icons
import ExclamationCircleOutlined from '@ant-design/icons/lib/icons/ExclamationCircleOutlined';
import { MAPPING_ROW_PROPS_MAP } from '@./constants/mapping';

interface Props {
  handleDataUpdate: (newMappings: DestinationMapping, newTableName?: string) => void;
}

const DestinationEditorMappingsLibrary = ({ handleDataUpdate }: Props) => {
  const mapFunction = (row: FieldMapping): DestinationMappingRow => Object
    .keys(MAPPING_ROW_PROPS_MAP)
    .reduce((accumulator: DestinationMappingRow, key: string) => {
      const catalogKey = MAPPING_ROW_PROPS_MAP[key];

      if (row[catalogKey]) {
        accumulator = {
          ...accumulator,
          [key]: row[catalogKey]
        };
      }

      return accumulator;
    }, {} as DestinationMappingRow);

  const setLibraryMapping = (library: Mapping) => {
    const newMappings = {
      _keepUnmappedFields: library.keepUnmappedFields ? Number(library.keepUnmappedFields) : 1,
      _mappings: library.mappings.map(mapFunction)
    };

    handleDataUpdate(newMappings, library.tableNameTemplate);
  };

  const handleClick = (library: Mapping, key: string) => () => {
    Modal.confirm({
      title: 'Mapping library',
      icon: <ExclamationCircleOutlined/>,
      content: <>Existing mapping will be overwritten by <strong>{key}</strong> library values.</>,
      okText: `Update with ${key}`,
      cancelText: 'Cancel',
      onOk: () => {
        setLibraryMapping(library);
      },
      onCancel: () => {
      }
    })
  };

  return (
    <>
      <article className="text-xs italic text-secondaryText mb-5">Using default mapping library wil overwrite current mappings settings.</article>
      <div className={styles.library}>
        {
          Object.keys(mappings).map((key: string) => {
            const library: Mapping = mappings[key];

            return (
              <div key={key} className={styles.item}>
                <div>
                  <p className={styles.name}>{key}</p>
                  {library.comment && <p className={styles.comment}>{library.comment}</p>}
                </div>
                <Button type="primary" onClick={handleClick(library, key)}>Apply</Button>
              </div>
            );
          })
        }
      </div>
    </>
  );
};

DestinationEditorMappingsLibrary.displayName = 'DestinationEditorMappingsLibrary';

export { DestinationEditorMappingsLibrary };
