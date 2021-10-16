import { FormItemAntd, FormItemAntdProps } from './FormItemAntd';
import sourceEditorStyles from './FormItemAntd.module.less';

type Props = FormItemAntdProps & {};

export const FormItemAntdSourceEditor: React.FC<Props> = ({
  className,
  children,
  ...formItemAntdProps
}) => (
  <FormItemAntd
    className={`${sourceEditorStyles.field} ${className}`}
    {...formItemAntdProps}
  >
    {children}
  </FormItemAntd>
);
