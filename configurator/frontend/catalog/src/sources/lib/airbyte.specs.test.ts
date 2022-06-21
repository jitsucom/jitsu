import { allMockAirbyteSourcesSpecs } from "../../mockData/airbyte/sourcesConfigs/mockAirbyteSourcesSpecs"
import { allMockJitsuAirbyteSourceConnectors } from "../../mockData/airbyte/sourcesConfigs/mockJitsuAirbyteSourcesSpecs"
import { mockJitsuConfigFormData } from "../../mockData/airbyte/sourcesConfigs/mockJitsuConfigFormData"
import { mapAirbyteSpecToSourceConnectorConfig } from "./airbyte.helper"

describe("mapAirbyteSpecToSourceConnectorConfig", () => {
  describe("", () => {
    const mockSourceConnectorData = allMockJitsuAirbyteSourceConnectors
    const mockAirbyteSourcesSpecs = allMockAirbyteSourcesSpecs

    Object.entries(mockSourceConnectorData).forEach(([name, true_connector_parameters]) => {
      const airbyte_spec = mockAirbyteSourcesSpecs[name].connectionSpecification
      const mapped_connector_parameters = mapAirbyteSpecToSourceConnectorConfig(airbyte_spec)

      it(`maps ${name} spec as expected`, () => {
        const mapped_connector_parameters_without_constant_and_omitFieldRule =
          // excludes the `constant` and `omitFieldRule` fields as they require a separate check
          mapped_connector_parameters.map(({ constant, omitFieldRule, ...connector }) => connector)
        const true_connector_parameters_without_constant_and_omitFieldRule =
          // excludes the `constant` and `omitFieldRule` fields as they require a separate check
          true_connector_parameters.map(({ constant, omitFieldRule, ...rest }) => rest)

        expect(mapped_connector_parameters_without_constant_and_omitFieldRule).toEqual(
          true_connector_parameters_without_constant_and_omitFieldRule
        )
      })

      if (mapped_connector_parameters.filter(({ omitFieldRule }) => !!omitFieldRule).length) {
        true_connector_parameters.forEach((true_parameter, idx) => {
          const mapped_parameter = mapped_connector_parameters[idx]
          if (typeof true_parameter.omitFieldRule === "function") {
            it(`creates ${name} ${true_parameter.displayName} parameter's \`omitFieldRule\` rule as expected`, () => {
              const true_render_result = true_parameter.omitFieldRule(mockJitsuConfigFormData)
              const mapped_render_result = mapped_parameter.omitFieldRule(mockJitsuConfigFormData)
              expect(mapped_render_result).toEqual(true_render_result)
            })
          }
        })
      }
    })
  })
})
