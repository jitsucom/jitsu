import { testJitsuFunction, TestOptions } from "./lib/testing-lib";
import MixpanelDestination from "../src/functions/mixpanel-destination";
import { event, group, identify } from "./lib/test-data";
import { MixpanelCredentials } from "../src/meta";
import { getLog } from "juava";
import * as JSON5 from "json5";

/**
 * We use two projects for testing MixPanel:
 *
 *  https://mixpanel.com/project/3168139/ - with enabled simplified API (=simplified identity management)
 *  https://mixpanel.com/project/3168263/ - with disabled simplified API (=old identity management)
 *
 * Tests are semi-automated, because MixPanel doesn't provide API for deleting events. Do a manual project reset
 * and set TEST_MIXPANEL_DESTINATION env variable to the token of the project you want to test.
 *
 * For 3168139 - simplified. Insert real credentials to test.
 * TEST_MIXPANEL_DESTINATION={projectId: 3168139, simplifiedIdentityMerge: true, enableGroupAnalytics: true, enableAnonymousUserProfiles: true, groupKey: "$group_id", serviceAccountUserName: "jitsu-destination-tests.a985cb.mp-service-account", projectToken: "", serviceAccountPassword: ""}
 * For 3168263 - old. Insert real credentials to test.
 * TEST_MIXPANEL_DESTINATION={projectId: 3168263, simplifiedIdentityMerge: false, enableGroupAnalytics: true, enableAnonymousUserProfiles: true, groupKey: "$group_id", serviceAccountUserName: "jitsu-destination-tests.a985cb.mp-service-account", projectToken: "", serviceAccountPassword: ""}
 *
 */
test("mixpanel-destination-integration", async () => {
  if (!process.env.TEST_MIXPANEL_DESTINATION) {
    console.log("Skipping mixpanel destination integration test - TEST_MIXPANEL_DESTINATION is not set");
    return;
  }
  const config = JSON5.parse(process.env.TEST_MIXPANEL_DESTINATION);
  getLog().atInfo().log(`Testing MixPanel destination. Project https://mixpanel.com/project/${config.projectId}. Simplified: ${!!config.simplifiedIdMerge}`);
  const events = [
    event("page", { anonymousId: "anon1", url: "http://sample-website.com/landing?utm_source=ads&utm_campaign=ad" }),
    event("page", { anonymousId: "anon1", url: "http://sample-website.com/contact" }),

    //identify() with email, but not userId. Can happen when a user fills a contact form on the website
    identify({
      anonymousId: "anon1",
      url: "http://sample-website.com/contact",
      traits: { email: "john.doe@customer.com" },
    }),
    event("page", {
      anonymousId: "anon1",
      url: "http://sample-website.com/signup",
    }),

    //The next block of events is for server-side sign-flow
    identify({
      url: "http://sample-website.com/signup",
      userId: "user1",
      traits: { email: "john.doe@customer.com" },
    }),
    group({
      url: "http://sample-website.com/signup",
      groupId: "group1",
      userId: "user1",
      traits: {
        companyName: "Company Name",
      },
    }),
    event("signup", {
      url: "http://sample-website.com/signup",
      userId: "user1",
    }),

    //product usage - page views coming from browser with both anonymousId and userId
    //group and page view has no value, it's just a side effect of the running .group() and .identify() calls
    //locally
    group({
      url: "http://app.sample-website.com",
      userId: "user1",
      groupId: "group1",
    }),
    identify({
      url: "http://app.sample-website.com",
      userId: "user1",
      groupId: "group1",
    }),
    event("page", {
      url: "http://app.sample-website.com",
      userId: "user1",
      groupId: "group1",
    }),
  ];
  const opts: TestOptions<MixpanelCredentials> = {
    func: MixpanelDestination,
    configEnvVar: "TEST_MIXPANEL_DESTINATION",
    events: events,
  };
  await testJitsuFunction(opts);
});

test("mixpanel-destination-unit", () => {
  //implement later, when testing library is ready to mock fetch
});
