import { Card, Collapse, Typography } from 'antd';
import { FC, ReactNode } from 'react';
// @Icons
import {
  CheckOutlined,
  CopyOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons';
// @Styles
import styles from './ErrorCard.module.less';

type ErrorCardProps = {
  title?: string | ReactNode;
  icon?: ReactNode;
  description?: string | ReactNode;
  descriptionWithContacts?: string | null;
  stackTrace?: string;
  className?: string;
};

export const ErrorCard: FC<ErrorCardProps> = ({
  title,
  icon,
  description,
  descriptionWithContacts,
  stackTrace,
  className
}) => {
  return (
    <Card bordered={false} className={className}>
      <Card.Meta
        avatar={icon || <ExclamationCircleOutlined className={styles.icon} />}
        title={title || 'An Error Occured'}
        description={
          <>
            <>
              {description !== undefined ? (
                description
              ) : (
                <span>
                  {descriptionWithContacts !== undefined ? (
                    <>
                      {descriptionWithContacts}
                      {descriptionWithContacts && <br />}
                    </>
                  ) : (
                    <>
                      {
                        'The application component crashed because of an internal error.'
                      }
                      <br />
                    </>
                  )}
                  {
                    'Please, try to reload the page first and if the problem is still present contact us at'
                  }{' '}
                  <Typography.Paragraph
                    copyable={{ tooltips: false }}
                    className="inline"
                  >
                    {'support@jitsu.com'}
                  </Typography.Paragraph>{' '}
                  {'and our engineers will fix the problem asap.'}
                </span>
              )}
            </>
            <>
              {stackTrace && (
                <Collapse
                  bordered={false}
                  className={`mt-2 ${styles.stackTraceCard}`}
                >
                  <Collapse.Panel key={1} header="Error Stack Trace">
                    <Typography.Paragraph
                      copyable={{
                        text: stackTrace,
                        icon: [<CopyOutlined />, <CheckOutlined />]
                      }}
                      className={`flex flex-row ${styles.errorStackContainer}`}
                    >
                      <pre className="text-xs">{stackTrace}</pre>
                    </Typography.Paragraph>
                  </Collapse.Panel>
                </Collapse>
              )}
            </>
          </>
        }
      />
    </Card>
  );
};
