// @Libs
import React from 'react';
import { Form, Switch } from 'antd';
import { Link } from 'react-router-dom';
// @Hooks
import useLoader from '@hooks/useLoader';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Components
import { ListItem } from '@molecule/ListItem';
import { CenteredError, CenteredSpin } from '@./lib/components/components';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
// @Catalog sources
import { allSources } from '@catalog/sources/lib';

export interface Props {
  form: FormInstance;
}

const DestinationEditorSources = ({ form }: Props) => {
  const service = ApplicationServices.get();

  const [error, sourcesData] = useLoader(async() => await service.storageService.get('sources', service.activeProject.id));

  if (error) {
    return <CenteredError error={error} />
  } else if (!sourcesData) {
    return <CenteredSpin />
  }

  return (
    <>
      <h3>Choose connectors</h3>
      <article className="mb-5">
        <p>Connector is a source of data from platform API or database. You can read more about connectors in our <a href="https://jitsu.com/docs/sources-configuration" target="_blank" rel="noreferrer">documentation</a>.</p>
        {
          sourcesData.sources?.length === 0 && <p>If you haven't added any connectors yet you can do it <Link to="/sources">here</Link>.</p>
        }
      </article>

      <Form form={form} name="connected-sources">
        <Form.Item
          name="sources"
        >
          <ul>
            {
              sourcesData.sources?.map((source: SourceData) => {
                const proto = allSources.find(sourceConnector => sourceConnector.id === source.sourceProtoType);

                return <ListItem
                  prefix={<Switch />}
                  icon={proto.pic}
                  title={source.sourceId}
                  id={source.sourceId}
                  key={source.sourceId}
                />
              })
            }
          </ul>
        </Form.Item>
      </Form>
    </>
  );
};

DestinationEditorSources.displayName = 'DestinationEditorSources';

export { DestinationEditorSources };
