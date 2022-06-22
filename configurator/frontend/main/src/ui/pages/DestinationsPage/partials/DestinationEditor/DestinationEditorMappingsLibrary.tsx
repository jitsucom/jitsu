// @Libs
import { Button, Modal } from "antd"
// @Catalog
import mappings from "@jitsu/catalog/mappings/lib"
// @Styles
import styles from "./DestinationEditor.module.less"
// @Types
import { FieldMapping, DestinationConfigurationTemplate } from "@jitsu/catalog"
// @Icons
import ExclamationCircleOutlined from "@ant-design/icons/lib/icons/ExclamationCircleOutlined"
// @Components
import { TabDescription } from "ui/components/Tabs/TabDescription"
// @Constant
import { MAPPING_ROW_PROPS_MAP } from "constants/mapping"

interface Props {
  handleDataUpdate: (newMappings: DestinationMapping, newTableName?: string) => Promise<void>
}

const DestinationEditorMappingsLibrary = ({ handleDataUpdate }: Props) => {
  const mapFunction = (row: FieldMapping): DestinationMappingRow =>
    Object.keys(MAPPING_ROW_PROPS_MAP).reduce((accumulator: DestinationMappingRow, key: string) => {
      const catalogKey = MAPPING_ROW_PROPS_MAP[key]
      const rowValue = row[catalogKey]

      if (rowValue !== undefined && rowValue !== null) {
        accumulator = {
          ...accumulator,
          [key]: row[catalogKey],
        }
      }

      return accumulator
    }, {} as DestinationMappingRow)

  const setLibraryMapping = (library: DestinationConfigurationTemplate) => {
    const newMappings = {
      _keepUnmappedFields: library.keepUnmappedFields,
      _mappings: library.mappings.map(mapFunction),
    }

    handleDataUpdate(newMappings, library.tableNameTemplate)
  }

  const handleClick = (library: DestinationConfigurationTemplate, key: string) => () => {
    Modal.confirm({
      title: "Mapping library",
      icon: <ExclamationCircleOutlined />,
      content: (
        <>
          Existing mapping will be overwritten by <strong>{key}</strong> library values.
        </>
      ),
      okText: `Update with ${key}`,
      cancelText: "Cancel",
      onOk: () => {
        setLibraryMapping(library)
      },
      onCancel: () => {},
    })
  }

  return (
    <>
      <div className={styles.library}>
        {Object.entries(mappings).map(([key, library]) => (
          <div key={key} className={styles.item}>
            <div>
              <p className="font-bold capitalize">{library.displayName || key}</p>
              {library.comment && <p className={styles.comment}>{library.comment}</p>}
            </div>
            <Button type="primary" onClick={handleClick(library, key)}>
              Apply
            </Button>
          </div>
        ))}
      </div>
    </>
  )
}

DestinationEditorMappingsLibrary.displayName = "DestinationEditorMappingsLibrary"

export { DestinationEditorMappingsLibrary }
