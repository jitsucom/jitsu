import { JitsuFunction } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { Client } from "@hubspot/api-client";

const MyFunction: JitsuFunction<AnalyticsServerEvent, any> = async (event, ctx) => {
  ctx.log.debug(
    `HubspotFunction function (props=${JSON.stringify(ctx.props)}) received event ${JSON.stringify(event)}`
  );
  const hubspotClient = new Client({ accessToken: ctx.props.accessToken });
  hubspotClient.init();
  ctx.log.info("HubspotFunction");
};

export default MyFunction;
