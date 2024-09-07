import { z } from "zod";

const eventsParamDescription = `
List of events to send, delimited by comma. Following <code>page</code>, <code>screen</code>, or any arbitrary event (name of <code>track</code> event). 
Special values: <b>empty string</b> - send only <code>track</code> events, <b>*</b> - send all events useful if you want to filter events with Functions 
`;
export const FacebookConversionApiCredentials = z.object({
  pixelId: z.string().describe("Facebook Pixel ID"),
  accessToken: z.string().describe("Facebook Access Token"),
  actionSource: z
    .enum(["email", "website", "app", "phone_call", "chat", "physical_store", "system_generated", "other"])
    .default("website")
    .describe("Action Source"),
  events: z.string().optional().default("").describe(eventsParamDescription),
  phoneFieldName: z
    .string()
    .optional()
    .default("")
    .describe(
      "Name of the field in the event user traits that contains the phone number. Expected format could be <a href='https://en.wikipedia.org/wiki/E.164' target='_blank' rel='noreferrer noopener'>E.164</a> or international format. If empty, phone number hash will not be sent."
    ),
});

export const FacebookConversionApiCredentialsUi = {
  accessToken: {
    password: true,
  },
};

export type FacebookConversionApiCredentials = z.infer<typeof FacebookConversionApiCredentials>;

export const WebhookDestinationConfig = z.object({
  url: z.string().url().describe("Webhook URL"),
  method: z
    .enum(["GET", "POST", "PUT", "DELETE"])
    .default("POST")
    .describe("HTTP method. Can be <code>GET</code>, <code>POST</code>, <code>PUT</code>, <code>DELETE</code>"),
  headers: z.array(z.string()).optional().describe("List of headers in format <code>key: value</code>"),
});

export type WebhookDestinationConfig = z.infer<typeof WebhookDestinationConfig>;

const MixpanelServiceAccountDocumentation =
  'See <a href="https://developer.mixpanel.com/reference/service-accounts">how to create service account</a>';

export const IntercomDestinationCredentials = z.object({
  accessToken: z
    .string()
    .describe(
      "Intercom Access Token. You should first create an app in Intercom Developer Hub, and then generate an access token in the app settings. See <a href='https://developers.intercom.com/docs/build-an-integration/getting-started/' target='_blank' rel='noreferrer noopener'>a detailed guide</a>"
    ),
  updateLastSeenOnEveryEvent: z
    .boolean()
    .optional()
    .describe(
      "By default, the last seen property will be updated only on .identify() calls. If enabled, the property will be updated on every event. However, enabling this option may lead to higher API usage."
    ),
});

export type IntercomDestinationCredentials = z.infer<typeof IntercomDestinationCredentials>;

export const MixpanelCredentials = z.object({
  simplifiedIdMerge: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      `Simplified Identity Merge::Use Mixpanel <a href="https://docs.mixpanel.com/docs/tracking-methods/identifying-users">Simplified Identity Merge</a> feature.<br/>Enable this option if your Mixpanel project has the corresponding <a href="https://docs.mixpanel.com/docs/tracking-methods/identifying-users#how-do-i-switch-between-the-simplified-and-original-api">feature enabled</a>.<br/><b>Using this feature is highly recommended to achieve better quality Identity Merge</b>`
    ),
  projectId: z
    .string()
    .describe(
      'Project id can be found in the <a href="https://help.mixpanel.com/hc/en-us/articles/115004490503-Project-Settings">project settings</a>'
    ),
  projectToken: z
    .string()
    .describe('See <a href="https://developer.mixpanel.com/reference/project-token">how to obtain project secret</a>'),
  //apiSecret: z.string(),
  serviceAccountUserName: z.string().describe(MixpanelServiceAccountDocumentation),
  serviceAccountPassword: z.string().describe(MixpanelServiceAccountDocumentation),
  sendPageEvents: z
    .boolean()
    .optional()
    .default(true)
    .describe("If enabled, all page view events will be sent to Mixpanel."),
  sendIdentifyEvents: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If enabled, any identify() call will send an Identify event to Mixpanel in addition to the profile update"
    ),
  enableGroupAnalytics: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Mixpanel Group Analytics allows behavioral data analysis at a customized group level. Group Analytics is available as an add-on package to customers on <a href='https://mixpanel.com/pricing/' target='_blank' rel='noreferrer noopener'>Growth and Enterprise plans.</a>"
    ),
  filterBotTraffic: z.boolean().optional().default(true).describe("Don't send traffic from known bots to Mixpanel"),
  groupKey: z
    .string()
    .optional()
    .default("$group_id")
    .describe(
      "Group Key for Mixpanel Group Analytics. Make sure that Group Key in <a href='https://mixpanel.com/report' target='_blank' rel='noreferrer noopener'>Mixpanel project settings</a> matches the provided value."
    ),
  enableAnonymousUserProfiles: z
    .boolean()
    .optional()
    .default(false)
    .describe("If enabled, anonymous users will be tracked in Mixpanel"),
});
export type MixpanelCredentials = z.infer<typeof MixpanelCredentials>;

export const MixpanelCredentialsUi: Partial<
  Record<keyof MixpanelCredentials, { documentation?: string; password?: boolean; hidden?: boolean }>
> = {
  serviceAccountPassword: {
    password: true,
  },
};

export const JuneCredentials = z.object({
  apiKey: z
    .string()
    .describe(
      `API Key::To get or create an API Key, go to workspace's "Settings & integrations" > Integrations > June SDK`
    ),
  enableAnonymousUserProfiles: z
    .boolean()
    .optional()
    .default(false)
    .describe("If enabled, anonymous users will be tracked in June"),
});
export type JuneCredentials = z.infer<typeof JuneCredentials>;

export const BrazeCredentials = z.object({
  apiKey: z.string().describe(`API Key::Created under Developer Console in the Braze Dashboard.`),
  endpoint: z
    .enum([
      "US-01 : dashboard-01.braze.com",
      "US-02 : dashboard-02.braze.com",
      "US-03 : dashboard-03.braze.com",
      "US-04 : dashboard-04.braze.com",
      "US-05 : dashboard-05.braze.com",
      "US-06 : dashboard-06.braze.com",
      "US-07 : dashboard-07.braze.com",
      "US-08 : dashboard-08.braze.com",
      "US-09 : dashboard-09.braze.com",
      "EU-01 : dashboard-01.braze.eu",
      "EU-02 : dashboard-02.braze.eu",
    ])
    .optional()
    .default("US-01 : dashboard-01.braze.com")
    .describe(
      "Your Braze REST endpoint. <a target='_blank' rel='noopener noreferrer' href='https://www.braze.com/docs/api/basics/#endpoints'>More details</a>"
    ),
  appId: z
    .string()
    .optional()
    .describe(
      "App ID::The app identifier used to reference specific Apps in requests made to the Braze API. Created under Developer Console in the Braze Dashboard."
    ),
  useJitsuAnonymousIdAlias: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Use Anonymous Id Alias::Use Jitsu <code>anonymousId</code> as an alias for identified and anonymous profiles. Enables support for anonymous (alias-only) profiles."
    ),
  sendPageEvents: z
    .boolean()
    .optional()
    .default(false)
    .describe("Send <code>page</code> and <code>screen</code> events as Braze Custom Events"),
});
export type BrazeCredentials = z.infer<typeof BrazeCredentials>;

export const SegmentCredentials = z.object({
  apiBase: z.string().default("https://api.segment.io/v1").describe("API Base::Segment API Base"),
  writeKey: z
    .string()
    .describe(
      `To get an API Key you need to add the HTTP API source to your Segment workspace. Write Key can be found on the HTTP API source Overview page.`
    ),
});
export type SegmentCredentials = z.infer<typeof SegmentCredentials>;

export const POSTHOG_DEFAULT_HOST = "https://app.posthog.com";

export const PosthogDestinationConfig = z.object({
  key: z
    .string()
    .describe(
      "Project API Key::Posthog Project API Key. Can be found in <a target='_blank' rel='noopener noreferrer' href='https://app.posthog.com/project/settings'>Project Settings</a>"
    ),
  host: z.string().optional().default(POSTHOG_DEFAULT_HOST).describe("Posthog host"),
  enableGroupAnalytics: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Group analytics is a powerful feature in PostHog that allows you to perform analytics on entities other than single users. Group Analytics is not available on the open-source or free cloud plan. <a href='https://posthog.com/pricing' target='_blank' rel='noreferrer noopener'>Learn more.</a>"
    ),
  groupType: z
    .string()
    .optional()
    .default("company")
    .describe(
      "Group type is the abstract type of whatever our group represents (e.g. company, team, chat, post, etc.). <a href='https://posthog.com/docs/getting-started/group-analytics#groups-vs-group-types' target='_blank' rel='noreferrer noopener'>Groups vs. group types.</a>"
    ),
  enableAnonymousUserProfiles: z
    .boolean()
    .optional()
    .default(false)
    .describe("If enabled, anonymous users will be tracked in Posthog"),
  //  sendIdentifyEvents: z.boolean().optional().default(false),
});

export type PosthogDestinationConfig = z.infer<typeof PosthogDestinationConfig>;

export const AmplitudeDestinationConfig = z.object({
  key: z.string().describe("Project API Key::Amplitude Project API Key."),
  enableGroupAnalytics: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Build an analysis around aggregated units of measure like accounts, charts, or order IDs. Requires The Amplitude Accounts add-on. <a href='https://help.amplitude.com/hc/en-us/articles/115001765532-Account-level-reporting-in-Amplitude' target='_blank' rel='noreferrer noopener'>Learn more.</a>"
    ),
  groupType: z
    .string()
    .optional()
    .default("company")
    .describe(
      "Group type is the abstract type of whatever our group represents (e.g. accounts, charts, or order IDs)."
    ),
  enableAnonymousUserProfiles: z
    .boolean()
    .optional()
    .default(false)
    .describe("If enabled, anonymous users will be tracked in Amplitude"),
  dataResidency: z.enum(["US", "EU"]).optional().default("US"),
  sessionWindow: z.number().optional().default(30).describe("Session window in minutes"),
});

export type AmplitudeDestinationConfig = z.infer<typeof AmplitudeDestinationConfig>;

export const MongodbDestinationConfig = z.object({
  url: z.string().optional(),
  protocol: z
    .enum(["mongodb", "mongodb+srv"])
    .default("mongodb")
    .describe(
      "MongoDB protocol. <code>mongodb</code> or <code>mongodb+srv</code>. For Atlas use <code>mongodb+srv</code>"
    ),
  hosts: z
    .array(z.string())
    .optional()
    .describe("MongoDB hosts with port (e.g. <code>localhost:27017</code>). One on each line"),
  username: z.string().describe("MongoDB username"),
  password: z.string().describe("MongoDB password"),
  database: z.string().describe("MongoDB database"),
  collection: z.string().describe("MongoDB collection"),

  options: z.object({}).catchall(z.string().default("")).optional().describe("Additional MongoDB connection options."),
});

export const MongodbDestinationConfigUi: Partial<
  Record<
    keyof MongodbDestinationConfig,
    {
      documentation?: string;
      editor?: string;
      hidden?: boolean;
      password?: boolean;
    }
  >
> = {
  hosts: {
    editor: "StringArrayEditor",
  },
  url: {
    hidden: true,
  },
  password: {
    password: true,
  },
};

export type MongodbDestinationConfig = z.infer<typeof MongodbDestinationConfig>;

export const Ga4Credentials = z.object({
  apiSecret: z
    .string()
    .describe(
      "An <code>API SECRET</code> generated in the Google Analytics UI. To create a new secret, navigate to:<br/>" +
        "<b>Admin > Data Streams > choose your stream > Measurement Protocol API Secrets > Create</b>"
    ),
  measurementId: z
    .string()
    .describe(
      "The measurement ID associated with a stream.<br/><b>For Web:</b> found in the Google Analytics UI under: " +
        "<b>Admin > Data Streams > choose your stream > Measurement ID</b><br/><b>For Apps</b>: the Firebase App ID, found in the Firebase console under: <b>Project Settings > General > Your Apps > App ID</b>"
    ),
  events: z.string().optional().default("").describe(eventsParamDescription),
  //validationMode: z.boolean().default(false).optional(),
});
export type Ga4Credentials = z.infer<typeof Ga4Credentials>;

export const HubspotCredentials = z.object({
  accessToken: z
    .string()
    .describe(
      [
        "To obtain an access secret, go to <b>Settings » Account Setup » Private Apps</b>, create a new private app copy the <b>Access token</b>. See <a href='https://developers.hubspot.com/docs/api/private-apps'>detailed guide</a>.",
        "Please make sure to grant an application all read and write permissions under CRM section",
      ].join("\n")
    ),
  sendPageViewEvents: z
    .boolean()
    .optional()
    .describe("When enabled, Jitsu will send page view events to hubspot (only events with a known email)"),
  autoCreateCustomProperties: z
    .boolean()
    .optional()
    .describe(
      "When enabled, Jitsu will automatically create HubSpot <a href='https://knowledge.hubspot.com/properties/create-and-edit-properties'>custom properties</a> for Contacts and Companies to capture every new trait. Otherwise, only known properties are sent."
    ),
});

export type HubspotCredentials = z.infer<typeof HubspotCredentials>;
