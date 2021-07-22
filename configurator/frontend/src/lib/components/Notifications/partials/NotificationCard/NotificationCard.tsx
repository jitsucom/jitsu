import { Card } from 'antd';
import styles from './NotificationCard.module.less';

type NotificationCardProps = {
  title?: string | React.ReactNode;
  message: string;
  size?: 'small' | 'default';
  icon?: React.ReactNode;
  onClick?: () => void;
};

export const NotificationCard: React.FC<NotificationCardProps> = ({
  title,
  message,
  size = 'small',
  icon,
  onClick
}) => {
  return (
    <button className={styles.card} onClick={onClick}>
      <Card
        title={<NotificationTitle title={title} icon={icon} />}
        size={size}
        bordered={false}
      >
        <Card.Meta description={message} />
      </Card>
    </button>
  );
};

type NotificationTitleProps = {
  title: string | React.ReactNode;
  icon?: React.ReactNode;
  time?: Date;
  size?: 'small' | 'default';
};

const NotificationTitle: React.FC<NotificationTitleProps> = ({
  title,
  icon,
  time,
  size = 'small'
}) => {
  return (
    <div className="flex items-center mt-1.5">
      {icon && (
        <div className="flex justify-center items-center flex-initial flex-shrink-0 mr-2.5">
          {icon}
        </div>
      )}
      {typeof title === 'string' ? (
        <h6 className={`block mb-0 text-${size === 'small' ? 'sm' : 'base'}`}>
          {title}
        </h6>
      ) : (
        title
      )}
      {time && <time className="block flex-initial flex-shrink-0">{time}</time>}
    </div>
  );
};
