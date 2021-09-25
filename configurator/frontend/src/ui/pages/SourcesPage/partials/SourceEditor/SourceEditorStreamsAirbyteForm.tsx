import { CaretRightOutlined } from '@ant-design/icons';
import { Collapse, Empty, Form, FormInstance, Switch, Typography } from 'antd';
import Search from 'antd/lib/input/Search';
import { Code } from 'lib/components/Code/Code';
import React, { useEffect, useState } from 'react';

interface Props {
  form: FormInstance;
  allStreams: Array<AirbyteStreamData>;
  initiallySelectedStreams: Array<AirbyteStreamData> | null;
  selectAllFieldsByDefault?: boolean;
}

const initAirbyteStreamsForm = (
  form: FormInstance,
  initialValues: AirbyteStreamData[]
): void => {
  const values = form.getFieldsValue();
  form.setFieldsValue({ catalog: { streams: initialValues } });
};

const addStreamInForm = (
  form: FormInstance,
  streamToAdd: AirbyteStreamData
): void => {
  const values = form.getFieldsValue();
  const selectedStreams = [...(values?.catalog?.streams ?? []), streamToAdd];
  form.setFieldsValue({ ...values, catalog: { streams: selectedStreams } });
  console.log('Added', form.getFieldsValue());
};

const handleUpdateStreamInForm = (
  form: FormInstance,
  streamToAdd: AirbyteStreamData
): void => {};

const deleteStreamFromForm = (
  form: FormInstance,
  streamToDelete: AirbyteStreamData
): void => {
  const values = form.getFieldsValue();
  const selectedStreams = (values?.catalog?.streams ?? []).filter(
    (selectedStream) =>
      !(
        selectedStream.stream.name === streamToDelete.stream.name &&
        selectedStream.stream.namespace === streamToDelete.stream.namespace
      )
  );
  form.setFieldsValue({ ...values, catalog: { streams: selectedStreams } });
};

const SourceEditorStreamsAirbyteForm = ({
  form,
  allStreams,
  initiallySelectedStreams,
  selectAllFieldsByDefault
}: Props) => {
  const [streamsToDisplay, setStreamsToDisplay] =
    useState<AirbyteStreamData[]>(allStreams);

  const handleToggleStream = (
    checked: boolean,
    stream: AirbyteStreamData
  ): void => {
    checked
      ? addStreamInForm(form, stream)
      : deleteStreamFromForm(form, stream);
  };

  const handleSearch = (query: string) => {
    setStreamsToDisplay((streams) =>
      streams.filter(
        (streamData) =>
          streamData.stream.name.includes(query) ||
          streamData.stream.namespace.includes(query)
      )
    );
  };

  const handleSearchValueClear = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (event.target.value === '')
      setTimeout(() => setStreamsToDisplay(allStreams), 0);
  };

  useEffect(() => {
    const initialValues = selectAllFieldsByDefault
      ? allStreams
      : initiallySelectedStreams;
    initAirbyteStreamsForm(form, initialValues);

    console.log('Initialized. Values: ', form.getFieldsValue());
  }, []);

  return (
    <div className="h-full w-full flex flex-col items-stretch">
      <Search
        enterButton="Search"
        className="mb-4"
        onSearch={handleSearch}
        onChange={handleSearchValueClear}
      />
      <div className="flex-auto overflow-y-auto">
        <Form form={form} className="hidden">
          {/**
           * An empty form used to register the catalog field
           */}
          <Form.Item name="catalog" />
        </Form>
        {streamsToDisplay?.length ? (
          <Collapse
            collapsible="header"
            expandIconPosition="left"
            destroyInactivePanel
            className="mr-2"
            expandIcon={({ isActive }) => (
              <CaretRightOutlined rotate={isActive ? 90 : 0} />
            )}
          >
            {streamsToDisplay.map((streamData) => {
              return (
                <Collapse.Panel
                  key={`${streamData.stream.name}__${streamData.stream.namespace}`}
                  header={
                    <div className="flex items-center w-full">
                      <div className={'grid grid-cols-5 flex-auto'}>
                        <div className={'whitespace-nowrap w-full'}>
                          <span className="inline-flex justify-between w-full">
                            <span className="block flex-shrink-0">
                              Name:&nbsp;&nbsp;
                            </span>
                            <b className="block flex-auto">
                              <Typography.Text ellipsis className="w-full">
                                {streamData.stream.name}
                              </Typography.Text>
                            </b>
                          </span>
                        </div>
                        <div className={'whitespace-nowrap'}>
                          Namespace:&nbsp;&nbsp;
                          <b>{streamData.stream.namespace}</b>
                        </div>
                        <div className={'whitespace-nowrap'}>
                          Sync Mode:&nbsp;&nbsp;<b>{streamData.sync_mode}</b>
                        </div>
                        <div className={'whitespace-nowrap'}>
                          Destination Sync Mode:&nbsp;&nbsp;
                          <b>{streamData.destination_sync_mode}</b>
                        </div>
                      </div>
                    </div>
                  }
                  extra={
                    <Switch
                      defaultChecked={
                        selectAllFieldsByDefault
                          ? true
                          : initiallySelectedStreams.some(
                              (selected) =>
                                selected.stream.name ===
                                  streamData.stream.name &&
                                selected.stream.namespace ===
                                  streamData.stream.namespace
                            )
                      }
                      className="absolute top-3 right-3"
                      onChange={(checked) =>
                        handleToggleStream(checked, streamData)
                      }
                    />
                  }
                >
                  <div className="max-h-72 w-full overflow-y-auto">
                    <Code language="json" className="w-full">
                      {JSON.stringify(
                        streamData.stream.json_schema?.properties,
                        null,
                        2
                      ) ?? 'null'}
                    </Code>
                  </div>
                </Collapse.Panel>
              );
            })}
          </Collapse>
        ) : (
          <Empty className="h-full flex flex-col justify-center items-center" />
        )}
      </div>
    </div>
  );
};
SourceEditorStreamsAirbyteForm.displayName = 'SourceEditorStreamsAirbyteForm';

export { SourceEditorStreamsAirbyteForm };
