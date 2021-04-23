// @Libs
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
// @Hooks
import useLoader from '@hooks/useLoader';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Components
import { CenteredError, CenteredSpin } from '@./lib/components/components';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { Item } from '@organism/ConnectedItems/ConnectedItems';
// @Catalog sources
import { allSources } from '@catalog/sources/lib';
import { ConnectedItems } from '@organism/ConnectedItems';

export interface Props {
  form: FormInstance;
  initialValues?: string[];
}

const DestinationEditorSources = ({ form, initialValues = [] }: Props) => {
  const service = ApplicationServices.get();

  const [error, sourcesData] = useLoader(async() => await service.storageService.get('sources', service.activeProject.id));

  const sourcesList = useMemo<Item[]>(() => sourcesData?.sources?.map((source: SourceData) => {
    const proto = allSources.find(s => s.id === source.sourceType);

    return {
      id: source.sourceId,
      title: source.sourceId,
      icon: proto.pic
    };
  }), [sourcesData?.sources]);

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

      <ConnectedItems
        form={form}
        formName="connected-sources"
        fieldName="_sources"
        itemsList={sourcesList}
        warningMessage={<p>Please, choose at least one source.</p>}
        initialValues={initialValues}
      />
    </>
  );
};

DestinationEditorSources.displayName = 'DestinationEditorSources';

export { DestinationEditorSources };
