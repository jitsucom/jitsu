// @Libs
import React, { useCallback, useMemo, useState } from 'react';
import { message } from 'antd';
import { Link, useHistory } from 'react-router-dom';
import { set, snakeCase } from 'lodash';
// @Components
import { SourceForm } from './SourceForm';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Routes
import { routes } from '@page/SourcesPage/routes';
// @Icons
import ArrowLeftOutlined from '@ant-design/icons/lib/icons/ArrowLeftOutlined';
// @Types
import { FormWrapProps } from '@page/SourcesPage/partials/_common/SourceForm/SourceForm.types';

const SourceFormWrap = ({
  sources,
  connectorSource,
  projectId,
  sourceData = {} as SourceData,
  formMode = 'create',
  setSources
}: FormWrapProps) => {
  const history = useHistory();

  const [isPending, switchPending] = useState(false);

  const services = useMemo(() => ApplicationServices.get(), []);

  const handleFinish = useCallback(
    ({ collections, ...rest }: any) => {
      switchPending(true);

      const payload = {
        sourceType: snakeCase(connectorSource.id),
        ...Object.keys(rest).reduce((accumulator: any, current: any) => {
          if (rest[current]) {
            set(accumulator, current, rest[current]);
          }

          return accumulator;
        }, {})
      };

      if (collections) {
        payload.collections = collections.map((collection: any) => ({
          name: collection.name,
          type: collection.type,
          parameters: connectorSource.collectionParameters.reduce((accumulator: any, current: any) => {
            return {
              ...accumulator,
              [current.id]: collection[current.id]
            };
          }, {})
        }));
      }

      services.storageService
        .save(
          'sources',
          {
            ...sources,
            [payload.sourceId]: payload
          },
          projectId
        )
        .then((response) => {
          setSources({
            ...sources,
            [payload.sourceId]: payload
          });

          message.success('New source has been added!');

          history.push(routes.root);
        })
        .catch((error) => {
          message.error("Something goes wrong, source hasn't been added");
        })
        .finally(() => switchPending(false));
    },
    [connectorSource.collectionParameters, connectorSource.id, services.storageService, projectId, sources, history, setSources]
  );

  return (
    <div className="add-source flex flex-col items-stretch">
      <p className="add-source__back">
        <Link className="add-source__back-link" to={routes.root}>
          <ArrowLeftOutlined className="add-source__back-link-ico" />
          <span>Back to sources list</span>
        </Link>
      </p>
      <div className="add-source__head">
        <div className="add-source__head-pic">{connectorSource.pic}</div>
        <div className="add-source__head-text">
          <h2 className="add-source__head-text-title">{connectorSource.displayName}</h2>
        </div>
      </div>

      <SourceForm
        formMode={formMode}
        initialValues={sourceData}
        connectorSource={connectorSource}
        isRequestPending={isPending}
        handleFinish={handleFinish}
        sources={sources}
      />
    </div>
  );
};

SourceFormWrap.displayName = 'SourceFormWrap';

export { SourceFormWrap };
