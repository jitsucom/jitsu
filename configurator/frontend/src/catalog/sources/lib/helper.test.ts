import { allMockAirbyteSourcesSpecs } from 'catalog/mockData/airbyte/sourcesConfigs/mockAirbyteSourcesSpecs';
import { allMockJitsuAirbyteSourceConnectors } from 'catalog/mockData/airbyte/sourcesConfigs/mockJitsuAirbyteSourcesSpecs';
import { mockJitsuConfigFormData } from 'catalog/mockData/airbyte/sourcesConfigs/mockJitsuConfigFormData';
import { typedObjectEntries } from 'utils/object';
import { toTitleCase } from 'utils/strings';
import { mapAirbyteSpecToSourceConnectorConfig } from './helper';

describe('mapAirbyteSpecToSourceConnectorConfig', () => {
  describe('', () => {
    const mockSourceConnectorData = allMockJitsuAirbyteSourceConnectors;
    const mockAirbyteSourcesSpecs = allMockAirbyteSourcesSpecs;

    typedObjectEntries(mockSourceConnectorData).forEach(
      ([name, true_connector_parameters]) => {
        const airbyte_spec =
          mockAirbyteSourcesSpecs[name].connectionSpecification;
        const mapped_connector_parameters =
          mapAirbyteSpecToSourceConnectorConfig(
            airbyte_spec,
            name,
            'connectionSpecification',
            [],
            null,
            'config.config'
          );

        it(`maps ${toTitleCase(name)} spec as expected`, () => {
          const mapped_connector_parameters_without_constant =
            mapped_connector_parameters.map(
              // excludes the `constant` field as it requires a separate check
              ({ constant, ...connector }) => connector
            );
          const true_connector_parameters_without_constant =
            // excludes the `constant` field as it requires a separate check
            true_connector_parameters.map(({ constant, ...rest }) => rest);

          expect(mapped_connector_parameters_without_constant).toEqual(
            true_connector_parameters_without_constant
          );
        });

        it(`maps ${toTitleCase(
          name
        )} \`constant\` parameters as expected`, () => {
          true_connector_parameters.forEach((true_parameter, idx) => {
            const mapped_parameter = mapped_connector_parameters[idx];
            if (true_parameter.constant === undefined) {
              expect(true_parameter.constant).toEqual(
                mapped_parameter.constant
              );
            } else if (typeof true_parameter.constant === 'function') {
              const true_render_result = true_parameter.constant(
                mockJitsuConfigFormData
              );
              const mapped_render_result = mapped_parameter.constant(
                mockJitsuConfigFormData
              );
              expect(mapped_render_result).toEqual(true_render_result);
            }
          });
        });
      }
    );
  });
});
