import { Card } from 'antd';
import React from 'react';
import { Link } from 'react-router-dom';
import styles from './EntityCard.module.less';

type EntityCardProps = {
  name: string | React.ReactNode;
  message?: React.ReactNode;
  size?: 'small' | 'default';
  link?: string;
  icon: React.ReactNode;
  onMouseEnter?: (...args: unknown[]) => void;
  onMouseLeave?: (...args: unknown[]) => void;
};

export const EntityCard: React.FC<EntityCardProps> = ({
  name,
  message,
  size = 'small',
  link,
  icon,
  onMouseEnter,
  onMouseLeave
}) => {
  return link ? (
    <Link
      to={link}
      className="w-full"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={`${styles.link} w-full`}>
        <Card size={size} bordered={false}>
          <Card.Meta
            title={<EntityCardTitle>{name}</EntityCardTitle>}
            avatar={icon}
            description={message}
          />
        </Card>
      </div>
    </Link>
  ) : (
    <div className={styles.card}>
      <Card size={size} bordered={false}>
        <Card.Meta
          title={<EntityCardTitle>{name}</EntityCardTitle>}
          avatar={icon}
          description={message}
        />
      </Card>
    </div>
  );
};

const EntityCardTitle: React.FC = ({ children }) => {
  return <div className="mt-2">{children}</div>;
};
