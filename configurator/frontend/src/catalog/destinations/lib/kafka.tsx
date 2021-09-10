import { arrayOf, stringType } from '../../sources/types';
import { ReactNode } from 'react';

let icon: ReactNode = (
    <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 32 32" preserveAspectRatio="xMidYMid">
      <path d="M21.538 17.724a4.16 4.16 0 0 0-3.128 1.42l-1.96-1.388c.208-.573.328-1.188.328-1.832a5.35 5.35 0 0 0-.317-1.802l1.956-1.373a4.16 4.16 0 0 0 3.122 1.414 4.18 4.18 0 0 0 4.172-4.172 4.18 4.18 0 0 0-4.172-4.172 4.18 4.18 0 0 0-4.172 4.172c0 .412.062.8.174 1.185l-1.957 1.374c-.818-1.014-1.995-1.723-3.336-1.94V8.25a4.18 4.18 0 0 0 3.313-4.082A4.18 4.18 0 0 0 11.388 0a4.18 4.18 0 0 0-4.172 4.172c0 1.98 1.387 3.637 3.24 4.063v2.4C7.928 11.067 6 13.273 6 15.925c0 2.665 1.947 4.88 4.493 5.308v2.523c-1.87.4-3.276 2.08-3.276 4.072A4.18 4.18 0 0 0 11.388 32a4.18 4.18 0 0 0 4.172-4.172c0-1.993-1.405-3.66-3.276-4.072v-2.523c1.315-.22 2.47-.916 3.28-1.907l1.973 1.397a4.15 4.15 0 0 0-.171 1.173 4.18 4.18 0 0 0 4.172 4.172 4.18 4.18 0 0 0 4.172-4.172 4.18 4.18 0 0 0-4.172-4.172zm0-9.754c1.115 0 2.022.908 2.022 2.023s-.907 2.022-2.022 2.022-2.022-.907-2.022-2.022.907-2.023 2.022-2.023zM9.366 4.172c0-1.115.907-2.022 2.023-2.022s2.022.907 2.022 2.022-.907 2.022-2.022 2.022-2.023-.907-2.023-2.022zM13.41 27.83c0 1.115-.907 2.022-2.022 2.022s-2.023-.907-2.023-2.022.907-2.022 2.023-2.022 2.022.907 2.022 2.022zm-2.023-9.082c-1.556 0-2.82-1.265-2.82-2.82s1.265-2.82 2.82-2.82 2.82 1.265 2.82 2.82-1.265 2.82-2.82 2.82zm10.15 5.172c-1.115 0-2.022-.908-2.022-2.023s.907-2.022 2.022-2.022 2.022.907 2.022 2.022-.907 2.023-2.022 2.023z"/>
    </svg>
);

const destination = {
  description: <>
    Apache Kafka is an open-source distributed event streaming platform used by thousands of companies for
    high-performance data pipelines, streaming analytics, data integration, and mission-critical applications.
  </>,
  syncFromSourcesStatus: 'supported',
  id: 'kafka',
  type: 'other',
  displayName: 'Kafka',
  hidden: false,
  ui: {
    icon,
    title: cfg => cfg?._formData?.kafkaBootstrapServers?.length
      ? cfg._formData.kafkaBootstrapServers[0]
      : 'Unknown',
    connectCmd: (_: object) => null
  },
  parameters: [
    tableName(),
    {
      id: '_formData.kafkaBootstrapServers',
      displayName: 'Bootstrap servers',
      required: true,
      type: arrayOf(stringType)
    }
  ]
} as const;

export default destination;
