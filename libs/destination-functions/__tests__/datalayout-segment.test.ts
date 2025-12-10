import { BulkerDestinationConfig, MappedEvent, segmentLayout } from "../src/functions/bulker-destination";

import {
  group,
  groupExpected,
  groupExpectedSingleTable,
  identify,
  identifyExpected,
  identifyExpectedSingleTable,
  page,
  pageExpected,
  pageExpectedSingleTable,
  track,
  trackExpected,
  trackExpectedSingleTable,
} from "./lib/datalayout-test-data";
import { FullContext } from "@jitsu/protocols/functions";

test("segment event", () => {
  const ctx = { props: {} } as FullContext<BulkerDestinationConfig>;
  const pageResult = segmentLayout(page, false, ctx);
  expect(Array.isArray(pageResult)).toBe(false);
  const pageEvent = (pageResult as MappedEvent).event;
  console.log(JSON.stringify(pageEvent, null, 2));
  expect(pageEvent).toStrictEqual(pageExpected);

  const identifyResult = segmentLayout(identify, false, ctx);
  expect(Array.isArray(identifyResult)).toBe(false);
  const identifyEvent = (identifyResult as MappedEvent).event;
  console.log(JSON.stringify(identifyEvent, null, 2));
  expect(identifyEvent).toStrictEqual(identifyExpected);

  const trackResult = segmentLayout(track, false, ctx);
  expect(Array.isArray(trackResult)).toBe(true);
  const trackEvents = (trackResult as MappedEvent[]).map(t => t.event);
  console.log(JSON.stringify(trackEvents, null, 2));
  expect(trackEvents).toStrictEqual(trackExpected);

  const groupResult = segmentLayout(group, false, ctx);
  expect(Array.isArray(groupResult)).toBe(false);
  const groupEvents = (groupResult as MappedEvent).event;
  console.log(JSON.stringify(groupEvents, null, 2));
  expect(groupEvents).toStrictEqual(groupExpected);
});

test("segment event single table", () => {
  const ctx = { props: {} } as FullContext<BulkerDestinationConfig>;
  const pageResult = segmentLayout(page, true, ctx);
  expect(Array.isArray(pageResult)).toBe(false);
  const pageEvent = (pageResult as MappedEvent).event;
  console.log(JSON.stringify(pageEvent, null, 2));
  expect(pageEvent).toStrictEqual(pageExpectedSingleTable);

  const identifyResult = segmentLayout(identify, true, ctx);
  expect(Array.isArray(identifyResult)).toBe(false);
  const identifyEvent = (identifyResult as MappedEvent).event;
  console.log(JSON.stringify(identifyEvent, null, 2));
  expect(identifyEvent).toStrictEqual(identifyExpectedSingleTable);

  const trackResult = segmentLayout(track, true, ctx);
  expect(Array.isArray(trackResult)).toBe(false);
  const trackEvent = (trackResult as MappedEvent).event;
  console.log(JSON.stringify(trackEvent, null, 2));
  expect(trackEvent).toStrictEqual(trackExpectedSingleTable);

  const groupResult = segmentLayout(group, true, ctx);
  expect(Array.isArray(groupResult)).toBe(false);
  const groupEvents = (groupResult as MappedEvent).event;
  console.log(JSON.stringify(groupEvents, null, 2));
  expect(groupEvents).toStrictEqual(groupExpectedSingleTable);
});
