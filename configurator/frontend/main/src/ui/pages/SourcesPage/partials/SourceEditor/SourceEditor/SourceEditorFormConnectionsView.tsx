// @Libs
import { useCallback, useState } from "react"
import { Switch } from "antd"
import useProject from "../../../../../../hooks/useProject"
import { allPermissions } from "../../../../../../lib/services/permissions"
import { ProjectPermission } from "../../../../../../generated/conf-openapi"

type Props = {
  itemsList: ConnectedItem[]
  initialValues?: string[]
  handleItemChange?: (selectedItems: string[]) => void
}

export interface ConnectedItem {
  id: string
  disabled?: boolean
  title: React.ReactNode
  description?: React.ReactNode
}

export const SourceEditorFormConnectionsView: React.FC<Props> = ({ itemsList, initialValues, handleItemChange }) => {
  const [selectedItems, setSelectedItems] = useState<string[]>(initialValues ?? [])
  const project = useProject();
  const disableEdit = !(project.permissions || allPermissions).includes(ProjectPermission.MODIFY_CONFIG);

  const handleChange = useCallback(
    (id: string) => (checked: boolean) => {
      const newItemsIds = [...selectedItems]

      if (checked) {
        newItemsIds.push(id)
      } else {
        const index = newItemsIds.findIndex(i => i === id)
        newItemsIds.splice(index, 1)
      }

      setSelectedItems(newItemsIds)
      handleItemChange(newItemsIds)
    },
    [selectedItems, handleItemChange]
  )

  return (
    <>
      {itemsList?.length > 0 && (
        <ul>
          {itemsList.sort().map(({ id, title, description, disabled }: ConnectedItem) => (
            <div className="flex flex-row flex-nowrap h-16" key={id}>
              <div className="flex-shrink pr-4">
                <Switch disabled={disableEdit || disabled} onChange={handleChange(id)} checked={selectedItems?.includes(id)} />
              </div>
              <div className="flex flex-col justify-start">
                <div key="title">{title}</div>
                <div key="description" className="text-xs text-secondaryText">
                  {description}
                </div>
              </div>
            </div>
          ))}
        </ul>
      )}
    </>
  )
}
