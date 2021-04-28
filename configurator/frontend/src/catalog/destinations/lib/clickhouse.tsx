import { Destination } from '../types';
import { modeParameter, tableName } from './common';
import { arrayOf, stringType } from '../../sources/types';
import * as React from 'react';
import { ReactNode } from 'react';

let icon: ReactNode = <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 8">
  <style>{'.o{fill:#fc0}.r{fill:red}'}</style>
  <path d="M0,7 h1 v1 h-1 z" className="r"/>
  <path d="M0,0 h1 v7 h-1 z" className="o"/>
  <path d="M2,0 h1 v8 h-1 z" className="o"/>
  <path d="M4,0 h1 v8 h-1 z" className="o"/>
  <path d="M6,0 h1 v8 h-1 z" className="o"/>
  <path d="M8,3.25 h1 v1.5 h-1 z" className="o"/>
</svg>

const destination: Destination = {
  syncFromSourcesStatus: 'supported',
  id: 'clickhouse',
  displayName: 'ClickHouse',
  ui: {
    icon,
    title: cfg => cfg?._formData?.ch_dsns_list?.length
      ? cfg._formData.ch_dsns_list[0]
      : 'Unknown',
    connectCmd: (cfg) => cfg?._formData?.ch_dsns_list?.length
      ? `echo 'SELECT 1' | curl '${cfg._formData.ch_dsns_list[0]}' --data-binary @-`
      : ''
  },
  parameters: [
    modeParameter(),
    tableName(),
    {
      id: '_formData.ch_dsns_list',
      displayName: 'Datasources',
      required: true,
      type: arrayOf(stringType),
      documentation: <>
        A list of DSNs (server names). It's recommended to add at least two servers within the cluster for redundancy{' '}
        <a href="https://jitsu.com/docs/destinations-configuration/clickhouse-destination#clickhouse">
          documentation
        </a>
      </>
    },
    {
      id: '_formData.ch_cluster',
      displayName: 'Cluster',
      required: true,
      type: stringType,
      documentation: <>
        <p>
          Cluster name. See{' '}
          <a
            href="https://jitsu.com/docs/destinations-configuration/clickhouse-destination#clickhouse">
            documentation
          </a>
          .
        </p>
        <p>
          Run <code>SELECT * from system.clusters</code> to the list of all available clusters
        </p>
      </>
    },
    {
      id: '_formData.ch_database',
      displayName: 'Database',
      documentation: <>Database name. See
        {' '}<a href="https://jitsu.com/docs/destinations-configuration/clickhouse-destination#clickhouse">documentation</a></>,
      required: true,
      type: stringType
    }
  ]
}

export default destination;
