import { Form, FormItemProps } from 'antd';

export type FormItemAntdProps = FormItemProps & {};

/**
 * Applies form-field_fixed-label class to the Antd Form.Item
 */
export const FormItemAntd: React.FC<FormItemAntdProps> = ({
  className,
  children,
  ...formItemProps
}) => (
  <Form.Item
    className={`form-field_fixed-label ${className}`}
    {...formItemProps}
  >
    {children}
  </Form.Item>
);
