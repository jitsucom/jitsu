// @Libs
import React, { useCallback, useState } from 'react';
import { Form, Switch, Typography } from 'antd';
import { FormInstance } from 'antd/es';
// @Components
import { ListItem } from '@molecule/ListItem';

export interface Item {
  id: string;
  title: React.ReactNode;
  icon: React.ReactNode;
}

export interface Props {
  form: FormInstance;
  formName: string;
  fieldName: string;
  itemsList: Item[];
  initialValues?: string[];
  warningMessage: React.ReactNode;
}

const ConnectedItems = ({ form, formName, fieldName, itemsList = [], initialValues = [], warningMessage }: Props) => {
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
    <Form form={form} name={formName}>
      <Form.Item name={fieldName}>
        <ul>
          {
            itemsList?.map(({ id, title, icon }: Item) => (
              <ListItem
                prefix={<Switch onChange={handleChange(id)} checked={selectedItems?.includes(id)} />}
                icon={icon}
                title={title}
                id={id}
                key={id}
              />
            ))
          }
        </ul>
      </Form.Item>

      {
        itemsList?.length > 0 && selectedItems.length === 0 && <Typography.Text type="warning">{warningMessage}</Typography.Text>
      }
    </Form>
  );
};

ConnectedItems.displayName = 'ConnectedItems';

export { ConnectedItems };
