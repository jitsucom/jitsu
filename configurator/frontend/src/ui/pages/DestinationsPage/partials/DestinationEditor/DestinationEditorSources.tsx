// @Libs
import React from 'react';
import { Avatar, Form, List, Switch } from 'antd';
// @Hooks
import useLoader from '@hooks/useLoader';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Components
import { CenteredError, CenteredSpin } from '@./lib/components/components';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { getIconSrc } from '@page/DestinationsPage/partials/DestinationsList/DestinationsList';
import { allSources } from '@catalog/sources/lib';
import { ListItem } from '@molecule/ListItem';

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
    <div>
      <Form form={form} name="connected-sources">
        <Form.Item
          name="sources"
        >
          <ul>
            {
              sourcesData.sources?.map((source: SourceData) => {
                // console.log('source: ', source);
                const proto = allSources.find(sourceConnector => sourceConnector.id === source.sourceProtoType);
                // console.log('proto: ', proto);

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
          {/*<List key="list" className="destinations-list" itemLayout="horizontal">*/}
          {/*  {sourcesData.sources?.map((source: SourceData) => {*/}
          {/*    const proto = allSources.find(sourceConnector => sourceConnector.id === source.sourceProtoType);*/}

          {/*    return <List.Item key={source.sourceId}>*/}
          {/*      <label htmlFor={source.sourceId} className="ant-switch-group-label">*/}
          {/*        <List.Item.Meta*/}
          {/*          avatar={<div className="ant-switch-group-label__avatar">*/}
          {/*            <Switch />*/}
          {/*            <span>{proto.pic}</span>*/}
          {/*          </div>}*/}
          {/*          title={source.connected*/}
          {/*            ? source.sourceId*/}
          {/*            : <span className="destinations-list-failed-connection">*/}
          {/*              <b>!</b> {source.sourceId}*/}
          {/*            </span>}*/}
          {/*        />*/}
          {/*      </label>*/}
          {/*    </List.Item>*/}
          {/*  })}*/}
          {/*</List>*/}
        </Form.Item>
      </Form>
    </div>
  );
};

DestinationEditorSources.displayName = 'DestinationEditorSources';

export { DestinationEditorSources };
