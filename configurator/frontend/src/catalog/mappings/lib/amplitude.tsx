import { DestinationConfigurationTemplate } from '../types';

const mapping: DestinationConfigurationTemplate = {
  displayName: 'Amplitude',
  comment: <>This templates converts incoming events to <a href="https://developers.amplitude.com/docs/http-api-v2">Amplitude</a> API calls.
    {' '}Make sure you use Amplitude destination, otherwise configuration won't make much sense
  </>,
  keepUnmappedFields: false,
  mappings: [
    {
      src: '/user/email',
      dst: '/user_id',
      action: 'move'
    },
    {
      src: '/user/anonymous_id',
      dst: '/device_id',
      action: 'move'
    },
    {
      src: '/event_type',
      dst: '/event_type',
      action: 'move'
    },
    {
      src: '/parsed_ua/os_family',
      dst: '/os_name',
      action: 'move'
    },
    {
      src: '/parsed_ua/os_version',
      dst: '/os_version',
      action: 'move'
    },
    {
      src: '/parsed_ua/os_version',
      dst: '/os_version',
      action: 'move'
    },
    {
      src: '/parsed_ua/device_brand',
      dst: '/device_brand',
      action: 'move'
    },
    {
      src: '/parsed_ua/device_family',
      dst: '/device_manufacturer',
      action: 'move'
    },
    {
      src: '/parsed_ua/device_model',
      dst: '/device_model',
      action: 'move'
    },
    {
      src: '/location/country',
      dst: '/country',
      action: 'move'
    },
    {
      src: '/location/region',
      dst: '/region',
      action: 'move'
    },
    {
      src: '/location/city',
      dst: '/city',
      action: 'move'
    },
    {
      src: '/user_language',
      dst: '/language',
      action: 'move'
    },
    {
      src: '/location/latitude',
      dst: '/location_lat',
      action: 'move'
    },
    {
      src: '/location/longitude',
      dst: '/location_lng',
      action: 'move'
    },
    {
      src: '/source_ip',
      dst: '/ip',
      action: 'move'
    },
    {
      src: '/eventn_ctx_event_id',
      dst: '/insert_id',
      action: 'move'
    }
  ]
}

export default mapping;
