import {
  CheckOutlined,
  CopyOutlined,
  ExclamationCircleFilled
} from '@ant-design/icons';
import { Card, Collapse, Typography } from 'antd';
import { FC, ReactNode } from 'react';

type ErrorCardProps = {
  title?: string | ReactNode;
  icon?: ReactNode;
  description?: string | ReactNode;
  descriptionWithContacts?: string;
  stackTrace?: string;
};

export const ErrorCard: FC<ErrorCardProps> = ({
  title,
  icon,
  description,
  descriptionWithContacts,
  stackTrace
}) => {
  return (
    <Card bordered={false}>
      <Card.Meta
        avatar={icon || <ExclamationCircleFilled />}
        title={title || 'An Error Occured'}
        description={
          description || (
            <span>
              {descriptionWithContacts ||
                'The application component crashed because of an internal error.'}{' '}
              {
                'Please, try to reload the page first and if the problem is still present contact us at'
              }{' '}
              <Typography.Paragraph copyable={{ tooltips: false }}>
                {'support@jitsu.com'}
              </Typography.Paragraph>{' '}
              {
                'and our engineers will fix the problem and follow up once the problem has been fixed.'
              }
            </span>
          )
        }
      />
      {stackTrace && (
        <Collapse defaultActiveKey={[1]}>
          <Collapse.Panel
            key={1}
            header="Error Stack Trace"
            extra={
              <Typography.Paragraph
                copyable={{
                  text: stackTrace,
                  icon: [<CopyOutlined />, <CheckOutlined />]
                }}
              />
            }
          >
            <p>{stackTrace}</p>
          </Collapse.Panel>
        </Collapse>
      )}
    </Card>
  );
};
