// @Libs
import React, { useCallback, useState } from 'react';
import { Form, Switch, Typography } from 'antd';
// @Components
import { ListItem } from '@molecule/ListItem';
// @Types
import { FormInstance } from 'antd/es';

export interface ConnectedItem {
  itemKey: string;
  id: string;
  link: string;
  title: React.ReactNode;
  icon?: React.ReactNode;
  description?: React.ReactNode;
  additional?: React.ReactNode;
}

export interface Props {
  form: FormInstance;
  fieldName: string;
  itemsList: ConnectedItem[];
  initialValues?: string[];
  warningMessage: React.ReactNode;
}

const ConnectedItems = ({ form, fieldName, itemsList = [], initialValues = [], warningMessage }: Props) => {
  const [selectedItems, setSelectedItems] = useState<string[]>(initialValues ?? []);

  const handleChange = useCallback((id: string) => (checked: boolean) => {
    const newItemsIds = [...selectedItems];

    if (checked) {
      newItemsIds.push(id);
    } else {
      const index = newItemsIds.findIndex(i => i === id);

      newItemsIds.splice(index, 1);
    }

    setSelectedItems(newItemsIds);

    /**
     * It would be necessary to refactor this code and add destructured form fields values
     *  if {fieldName} stops to be single
     * */
    form.setFieldsValue({
      [fieldName]: newItemsIds
    });
  }, [selectedItems, form, fieldName]);

  return (
    <>
      {
        itemsList?.length > 0 && (
          <Form.Item className="mb-1" name={fieldName}>
            <ul>
              {
                itemsList?.map(({ id, title, icon, itemKey, link, description, additional }: ConnectedItem) => (
                  <ListItem
                    prefix={<Switch onChange={handleChange(id)} checked={selectedItems?.includes(id)} />}
                    icon={icon}
                    title={title}
                    id={id}
                    key={itemKey}
                    link={link}
                    description={description}
                    additional={additional}
                  />
                ))
              }
            </ul>
          </Form.Item>
        )
      }

      {
        itemsList?.length > 0 && selectedItems.length === 0 && <Typography.Text type="warning">{warningMessage}</Typography.Text>
      }
    </>
  );
};

ConnectedItems.displayName = 'ConnectedItems';

export { ConnectedItems };
