import { Card } from 'antd';
import styles from './EntityCard.module.less';

type EntityCardProps = {
  name: string;
  message?: React.ReactNode;
  size?: 'small' | 'default';
  icon: React.ReactNode;
};

export const EntityCard: React.FC<EntityCardProps> = ({
  name,
  message,
  size = 'small',
  icon
}) => {
  return (
    <div className={styles.card}>
      <Card size={size} bordered={false}>
        <Card.Meta
          title={<div className="mt-2">{name}</div>}
          avatar={icon}
          description={message}
        />
      </Card>
    </div>
  );
};
