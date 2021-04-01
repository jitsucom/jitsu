import { DestinationConfig, PostgresConfig } from '../../services/destinations';
import * as React from 'react';

type DestinationProps<T extends DestinationConfig> = {
  config: T;
};

abstract class DestinationComponent<T extends DestinationConfig> extends React.Component<DestinationProps<T>> {}

class PostgresComponent extends DestinationComponent<PostgresConfig> {}
