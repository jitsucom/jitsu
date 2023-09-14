import { JitsuFunction } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { Client } from "@hubspot/api-client";

const HubspotFunction: JitsuFunction<AnalyticsServerEvent, any> = async (event, ctx) => {
  ctx.log.debug(
    `HubspotFunction function (props=${JSON.stringify(ctx.props)}) received event ${JSON.stringify(event)}`
  );
  //pat-na1-c0b0f694-4fd2-4483-9dee-c2d45ddbcfd5
  const hubspotClient = new Client({ accessToken: ctx.props.accessToken });
  hubspotClient.init();
  ctx.log.info("HubspotFunction");
};

export default HubspotFunction;
