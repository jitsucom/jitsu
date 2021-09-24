import { FC, useEffect, useState } from 'react';
import { Card, Spin } from 'antd';

type Props = {
  title: string;
  longLoadingMessage?: string;
  showLongLoadingMessageAfterMs?: number;
};

export const LoadableFieldsLoadingMessageCard: FC<Props> = ({
  title,
  longLoadingMessage,
  showLongLoadingMessageAfterMs
}) => {
  const [description, setDescription] = useState<null | string>(null);

  useEffect(() => {
    let timeout;
    if (true) {
      timeout = setTimeout(
        () => setDescription(longLoadingMessage),
        showLongLoadingMessageAfterMs
      );
    }

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  return (
    <Card className={'form-fields-card'}>
      <Card.Meta avatar={<Spin />} title={title} description={description} />
    </Card>
  );
};
