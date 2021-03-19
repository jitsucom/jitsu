// @Libs
import React, { useCallback, useMemo, useState } from 'react';
import { message } from 'antd';
import { set } from 'lodash';
// @Components
import { SourceForm } from './SourceForm';
// @Services
import ApplicationServices from '../../../../../../lib/services/ApplicationServices';
import { Link } from 'react-router-dom';
import { routes } from '@page/SourcesPage/routes';
import ArrowLeftOutlined from '@ant-design/icons/lib/icons/ArrowLeftOutlined';
import { FormWrapProps } from '@page/SourcesPage/partials/_common/SourceForm/SourceForm.types';

const SourceFormWrap = ({ sources, connectorSource, userUid, sourceData = {}, formMode = 'create' }: FormWrapProps) => {
  const [isPending, switchPending] = useState(false);

  const services = useMemo(() => ApplicationServices.get(), []);

  const handleFinish = useCallback(
    ({ collections, ...rest }: any) => {
      switchPending(true);

      const payload = {
        sourceType: connectorSource.id,
        collections: collections.map((collection: any) => ({
          name: collection.name,
          type: collection.type,
          parameters: connectorSource.collectionParameters.reduce(
            (accumulator: any, current: any) => ({
              ...accumulator,
              [current.id]: collection[current.id]
            }),
            {}
          )
        })),
        ...Object.keys(rest).reduce((accumulator: any, current: any) => {
          if (rest[current]) {
            set(accumulator, current, rest[current]);
          }

          return accumulator;
        }, {})
      };

      services.storageService
        .save(
          'sources',
          {
            ...sources,
            [payload.sourceId]: payload
          },
          userUid
        )
        .then(() => {
          switchPending(false);

          message.success('New source has been added!');
        })
        .catch((error) => {
          message.error("Something goes wrong, source hasn't been added");
        });
    },
    [connectorSource.id, connectorSource.collectionParameters, services.storageService, userUid, sources]
  );

  return (
    <>
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
        alreadyExistSources={sources}
      />
    </>
  );
};

export { SourceFormWrap };
