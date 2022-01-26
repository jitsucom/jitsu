// @Libs
import React, { ReactNode, useCallback, useState } from "react"
import { Form, Switch } from "antd"
// @Types
import { FormInstance } from "antd/es"

export interface ConnectedItem {
  id: string
  disabled?: boolean
  title: React.ReactNode
  description?: React.ReactNode
}

export interface Props {
  form: FormInstance
  fieldName: string
  itemsList: ConnectedItem[]
  initialValues?: string[]
  warningMessage: React.ReactNode
  handleItemChange?: (selectedItems: string[]) => void
}

export const NameWithPicture: React.FC<{ icon: ReactNode; children: ReactNode }> = ({ icon, children }) => {
  return (
    <span>
      <span className="w-6 inline-block align-middle">
        <span className="flex items-center justify-center pr-1">{icon}</span>
      </span>
      <span className="inline-block align-middle">{children}</span>
    </span>
  )
}

const ConnectedItems = ({
  form,
  fieldName,
  itemsList = [],
  initialValues = [],
  warningMessage,
  handleItemChange,
}: Props) => {
  const [selectedItems, setSelectedItems] = useState<string[]>(initialValues ?? [])

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
      /**
       * It would be necessary to refactor this code and add destructured form fields values
       *  if {fieldName} stops to be single
       * */
      form.setFieldsValue({
        [fieldName]: newItemsIds,
      })

      handleItemChange(newItemsIds)
    },
    [selectedItems, form, fieldName, handleItemChange]
  )

  return (
    <>
      {itemsList?.length > 0 && (
        <Form.Item className="mb-1" name={fieldName} initialValue={initialValues}>
          <ul>
            {itemsList.sort().map(({ id, title, description, disabled }: ConnectedItem) => (
              <div className="flex flex-row flex-nowrap h-16" key={id}>
                <div className="flex-shrink pr-4">
                  <Switch disabled={disabled} onChange={handleChange(id)} checked={selectedItems?.includes(id)} />
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
        </Form.Item>
      )}
    </>
  )
}

ConnectedItems.displayName = "ConnectedItems"

export { ConnectedItems }
