// @Libs
import React from 'react';
import { Empty, Badge } from 'antd';
import { observer } from 'mobx-react-lite';
// @Store
import {
  inAppNotificationsStore,
  NotificationData
} from 'stores/inAppNotifications';
// @Icons
import { ExclamationCircleFilled } from '@ant-design/icons';
// @Components
import { NotificationCard } from './partials/NotificationCard/NotificationCard';
// @Styles
import styles from './Notifications.module.less';

const makeIcon = (
  notificationType: NotificationData['type'],
  notificationIcon?: React.ReactNode
): React.ReactNode => {
  const typeIcon = makeIconByNotificationType(notificationType);
  return notificationIcon
    ? makeIconWithBadge(notificationIcon, typeIcon)
    : typeIcon;
};

const makeIconByNotificationType = (
  type: NotificationData['type']
): React.ReactNode => {
  switch (type) {
    case 'danger':
      return <ExclamationCircleFilled className={styles.dangerIcon} />;
    default:
      return undefined;
  }
};

const makeIconWithBadge = (
  icon: React.ReactNode,
  badge: React.ReactNode
): React.ReactNode => {
  return (
    <Badge count={badge} size="small">
      <div className="h-5 w-5">{icon}</div>
    </Badge>
  );
};

const NotificationsComponent: React.FC = () => {
  const notifications = inAppNotificationsStore.notifications;
  return (
    <div className="h-full">
      {notifications.length ? (
        <>
          {notifications.map(({ id, title, message, type, icon }) => (
            <div key={id} className="my-2">
              <NotificationCard
                title={title}
                message={message}
                icon={makeIcon(type, icon)}
              />
            </div>
          ))}
        </>
      ) : (
        <div>
          <Empty description={`Notifications list is empty`} />
        </div>
      )}
    </div>
  );
};

const Notifications = observer(NotificationsComponent);

Notifications.displayName = 'Notifications';

export { Notifications };
