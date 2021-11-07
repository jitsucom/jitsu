export const mockAirbyteSourcesStreams = [
  // {
  //   name: 'annotations',
  //   json_schema: {
  //     $schema: 'http://json-schema.org/draft-07/schema#',
  //     type: 'object',
  //     additionalProperties: false,
  //     properties: {
  //       date: { type: ['null', 'string'], format: 'date-time' },
  //       project_id: { type: ['null', 'integer'] },
  //       id: { type: ['null', 'integer'] },
  //       description: { type: ['null', 'string'] }
  //     }
  //   },
  //   supported_sync_modes: ['full_refresh'],
  //   source_defined_primary_key: [['id']]
  // },
  // {
  //   name: 'cohorts',
  //   json_schema: {
  //     $schema: 'http://json-schema.org/draft-07/schema#',
  //     type: 'object',
  //     additionalProperties: false,
  //     properties: {
  //       id: { type: ['null', 'integer'] },
  //       name: { type: ['null', 'string'] },
  //       description: { type: ['null', 'string'] },
  //       created: { type: ['null', 'string'], format: 'date-time' },
  //       count: { type: ['null', 'integer'] },
  //       is_visible: { type: ['null', 'integer'] },
  //       project_id: { type: ['null', 'integer'] }
  //     }
  //   },
  //   supported_sync_modes: ['full_refresh'],
  //   source_defined_primary_key: [['id']]
  // },
  // {
  //   name: 'cohort_members',
  //   json_schema: {
  //     $schema: 'http://json-schema.org/draft-07/schema#',
  //     type: 'object',
  //     additionalProperties: true,
  //     properties: {
  //       cohort_id: { type: ['null', 'integer'] },
  //       distinct_id: { type: ['null', 'string'] }
  //     }
  //   },
  //   supported_sync_modes: ['full_refresh'],
  //   source_defined_primary_key: [['distinct_id']]
  // },
  // {
  //   name: 'engage',
  //   json_schema: {
  //     $schema: 'http://json-schema.org/draft-07/schema#',
  //     type: 'object',
  //     additionalProperties: true,
  //     properties: { distinct_id: { type: ['null', 'string'] } }
  //   },
  //   supported_sync_modes: ['full_refresh'],
  //   source_defined_primary_key: [['distinct_id']]
  // },
  // {
  //   name: 'export',
  //   json_schema: {
  //     $schema: 'http://json-schema.org/draft-07/schema#',
  //     type: 'object',
  //     additionalProperties: true,
  //     properties: {
  //       event: { type: ['null', 'string'] },
  //       distinct_id: { type: ['null', 'string'] },
  //       time: { type: ['null', 'string'], format: 'date-time' },
  //       labels: {
  //         anyOf: [
  //           { type: 'array', items: { type: 'string' } },
  //           { type: 'null' }
  //         ]
  //       },
  //       sampling_factor: { type: ['null', 'integer'] },
  //       dataset: { type: ['null', 'string'] },
  //       browser_version: { type: ['null', 'string'] },
  //       current_url: { type: ['null', 'string'] },
  //       device_id: { type: ['null', 'string'] },
  //       initial_referrer: { type: ['null', 'string'] },
  //       initial_referring_domain: { type: ['null', 'string'] },
  //       lib_version: { type: ['null', 'string'] },
  //       screen_height: { type: ['null', 'string'] },
  //       screen_width: { type: ['null', 'string'] },
  //       mp_lib: { type: ['null', 'string'] },
  //       event_name: { type: ['null', 'string'] },
  //       mp_country_code: { type: ['null', 'string'] },
  //       region: { type: ['null', 'string'] },
  //       city: { type: ['null', 'string'] },
  //       browser: { type: ['null', 'string'] },
  //       os: { type: ['null', 'string'] },
  //       referrer: { type: ['null', 'string'] },
  //       referring_domain: { type: ['null', 'string'] },
  //       search_engine: { type: ['null', 'string'] },
  //       device: { type: ['null', 'string'] },
  //       utm_source: { type: ['null', 'string'] },
  //       utm_campaign: { type: ['null', 'string'] },
  //       mp_keyword: { type: ['null', 'string'] },
  //       duration_s: { type: ['null', 'string'] },
  //       event_count: { type: ['null', 'string'] },
  //       origin_end: { type: ['null', 'string'] },
  //       origin_start: { type: ['null', 'string'] }
  //     }
  //   },
  //   supported_sync_modes: ['full_refresh', 'incremental'],
  //   source_defined_cursor: true,
  //   default_cursor_field: ['time']
  // },
  {
    name: "funnels",
    json_schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      properties: {
        funnel_id: { type: ["null", "integer"] },
        name: { type: ["null", "string"] },
        date: { type: ["null", "string"], format: "date" },
        datetime: { type: ["null", "string"], format: "date-time" },
        steps: {
          anyOf: [
            {
              type: "array",
              items: {
                type: ["null", "object"],
                additionalProperties: true,
                properties: {
                  count: { type: ["null", "integer"] },
                  avg_time: { type: ["null", "number"], multipleOf: 1e-20 },
                  avg_time_from_start: {
                    type: ["null", "number"],
                    multipleOf: 1e-20,
                  },
                  goal: { type: ["null", "string"] },
                  overall_conv_ratio: {
                    type: ["null", "number"],
                    multipleOf: 1e-20,
                  },
                  step_conv_ratio: {
                    type: ["null", "number"],
                    multipleOf: 1e-20,
                  },
                  event: { type: ["null", "string"] },
                  session_event: { type: ["null", "string"] },
                  step_label: { type: ["null", "string"] },
                  selector: { type: ["null", "string"] },
                  selector_params: {
                    type: ["null", "object"],
                    additionalProperties: true,
                    properties: { step_label: { type: ["null", "string"] } },
                  },
                  time_buckets_from_start: {
                    type: ["null", "object"],
                    additionalProperties: false,
                    properties: {
                      lower: { type: ["null", "integer"] },
                      higher: { type: ["null", "integer"] },
                      buckets: {
                        anyOf: [{ type: "array", items: { type: "integer" } }, { type: "null" }],
                      },
                    },
                  },
                  time_buckets_from_prev: {
                    type: ["null", "object"],
                    additionalProperties: false,
                    properties: {
                      lower: { type: ["null", "integer"] },
                      higher: { type: ["null", "integer"] },
                      buckets: {
                        anyOf: [{ type: "array", items: { type: "integer" } }, { type: "null" }],
                      },
                    },
                  },
                },
              },
            },
            { type: "null" },
          ],
        },
        analysis: {
          type: ["null", "object"],
          additionalProperties: false,
          properties: {
            completion: { type: ["null", "integer"] },
            starting_amount: { type: ["null", "integer"] },
            steps: { type: ["null", "integer"] },
            worst: { type: ["null", "integer"] },
          },
        },
      },
    },
    supported_sync_modes: ["full_refresh", "incremental"],
    source_defined_cursor: true,
    default_cursor_field: ["date"],
    source_defined_primary_key: [["funnel_id"], ["date"]],
  },
  // {
  //   name: 'revenue',
  //   json_schema: {
  //     $schema: 'http://json-schema.org/draft-07/schema#',
  //     type: 'object',
  //     additionalProperties: false,
  //     properties: {
  //       date: { type: ['null', 'string'], format: 'date' },
  //       datetime: { type: ['null', 'string'], format: 'date-time' },
  //       count: { type: ['null', 'integer'] },
  //       paid_count: { type: ['null', 'integer'] },
  //       amount: { type: ['null', 'number'], multipleOf: 1e-20 }
  //     }
  //   },
  //   supported_sync_modes: ['full_refresh', 'incremental'],
  //   source_defined_cursor: true,
  //   default_cursor_field: ['date'],
  //   source_defined_primary_key: [['date']]
  // }
] as const
