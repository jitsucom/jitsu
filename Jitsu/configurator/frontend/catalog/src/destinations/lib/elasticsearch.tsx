import { filteringExpressionDocumentation, modeParameter, tableName } from "./common"
import { booleanType, descriptionType, passwordType, stringType } from "../../sources/types"
import * as logos from "../../sources/lib/logos"
import { Destination } from "../types"

const icon = logos.elasticsearch

const elasticsearchDestination: Destination = {
  description: <>Elasticsearch destination</>,
  syncFromSourcesStatus: "not_supported",
  id: "elasticsearch",
  type: "other",
  community: true,
  displayName: "Elasticsearch",
  parameters: [
    {
      id: "_super_type",
      constant: "npm",
    },
    {
      id: "_package",
      constant: "@tangible/jitsu-elasticsearch-destination@latest",
    },
    {
      id: "_formData.meta_package",
      displayName: "Community Package",
      type: descriptionType,
      defaultValue: (
        <>
          Implementation is based on <b>npm-package:</b>{" "}
          <a target={"_blank"} href={"https://www.npmjs.com/package/@tangible/jitsu-elasticsearch-destination"}>
            @tangible/jitsu-elasticsearch-destination
          </a>{" "}
          (version: latest)
          <br />
          Developed by{" "}
          <a target={"_blank"} href={"https://teamtangible.com"}>
            Tangible Inc
          </a>
        </>
      ),
    },
    {
      id: "_formData.anonymous",
      displayName: "Send anonymous data",
      required: false,
      type: booleanType,
      documentation: <>Send anonymous data to Elasticsearch if true or all data including user data if false.</>,
    },
    {
      id: "_formData.elasticsearch_domain",
      displayName: "Elasticsearch server URL",
      required: true,
      type: stringType,
      documentation: <>{`Elasticsearch server domain including protocol (http(s)://<domain>)`}</>,
    },
    {
      id: "_formData.elasticsearch_port",
      displayName: "Elasticsearch server port",
      required: false,
      type: stringType,
    },
    {
      id: "_formData.elasticsearch_apikey",
      displayName: "Elasticsearch Api Key",
      required: true,
      type: passwordType,
    },
    {
      id: "_formData.elasticsearch_target",
      displayName: "Elasticsearch target",
      required: true,
      type: stringType,
      documentation: (
        <>
          If the Elasticsearch security features are enabled, you must have the following index privileges for the
          target data stream, index, or index alias:
          <br />
          To add or overwrite a document using the PUT {`/<target>/_doc/<_id>`} request format, you must have the
          create, index, or write index privilege.
          <br />
          To add a document using the POST {`/<target>/_doc/`}, PUT {`/<target>/_create/<_id>`}, or POST{" "}
          {`/<target>/_create/<_id>`} request formats, you must have the create_doc, create, index, or write index
          privilege.
          <br />
          To automatically create a data stream or index with an index API request, you must have the auto_configure,
          create_index, or manage index privilege.
        </>
      ),
    },
  ],
  ui: {
    icon,
    connectCmd: null,
    title: cfg => "",
  },
}

export default elasticsearchDestination
