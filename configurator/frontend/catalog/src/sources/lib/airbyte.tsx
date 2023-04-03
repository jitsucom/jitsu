import * as logos from "./logos"
import { AirbyteSource } from "../types"
import {
  githubDocumentation,
  googleSheetsDocumentation,
  intercomDocumentation,
  mixpanelDocumentation,
  mySqlDocumentation,
  shopifyDocumentation,
  slackDocumentation,
  stripeDocumentation,
} from "./documentation"
import * as React from "react"

export const allAirbyteSources: AirbyteSource[] = [
  {
    pic: logos.amazon,
    docker_image_name: "airbyte/source-amazon-seller-partner",
    displayName: "Amazon Seller Partner",
    stable: false,
    documentation: {
      overview: (
        <>
          This source can sync data for the{" "}
          <a
            target="_blank"
            href="https://github.com/amzn/selling-partner-api-docs/blob/main/guides/en-US/developer-guide/SellingPartnerApiDeveloperGuide.md"
          >
            Amazon Seller Partner API
          </a>
          {": "}
          <a
            target="_blank"
            href="https://github.com/amzn/selling-partner-api-docs/blob/main/references/orders-api/ordersV0.md"
          >
            Orders
          </a>
        </>
      ),
      connection: (
        <>
          Information about how to get credentials you may find{" "}
          <a
            target="_blank"
            href="https://github.com/amzn/selling-partner-api-docs/blob/main/guides/en-US/developer-guide/SellingPartnerApiDeveloperGuide.md"
          >
            here
          </a>
          .
        </>
      ),
    },
  },
  {
    pic: logos.apify,
    docker_image_name: "airbyte/source-apify-dataset",
    displayName: "Apify Dataset",
    stable: false,
    documentation: {
      overview: (
        <>
          <a target="_blank" href="https://www.apify.com/">
            Apify
          </a>{" "}
          is a web scraping and web automation platform providing both ready-made and custom solutions, an open-source{" "}
          <a target="_blank" href="https://sdk.apify.com/">
            SDK
          </a>{" "}
          for web scraping, proxies, and many other tools to help you build and run web automation jobs at scale. The
          results of a scraping job are usually stored in{" "}
          <a target="_blank" href="https://docs.apify.com/storage/dataset">
            Apify Dataset
          </a>
          . This connector allows you to automatically sync the contents of a dataset to your chosen destination. To
          sync data from a dataset, all you need to know is its ID. You will find it in{" "}
          <a target="_blank" href="https://my.apify.com/">
            Apify console
          </a>{" "}
          under storages.
        </>
      ),
      connection: (
        <>
          Obtain Apify{" "}
          <a target="_blank" href="https://docs.apify.com/storage/dataset">
            Dataset
          </a>{" "}
          ID.
        </>
      ),
    },
  },
  {
    pic: logos.appstore,
    docker_image_name: "airbyte/source-appstore-singer",
    displayName: "App Store",
    stable: false,
    documentation: {
      overview: (
        <>
          This source can sync data for the{" "}
          <a target="_blank" href="https://developer.apple.com/documentation/appstoreconnectapi">
            Appstore API
          </a>
          . It supports only Incremental syncs. The Appstore API is available for{" "}
          <a target="_blank" href="https://developer.apple.com/documentation/appstoreconnectapi">
            many types of services
          </a>
          . Currently, this API supports syncing Sales and Trends reports.{": "}
          <a target="_blank" href="https://help.apple.com/app-store-connect/#/dev15f9508ca">
            SALES
          </a>
          {", "}
          <a target="_blank" href="https://help.apple.com/app-store-connect/#/itc5dcdf6693">
            SUBSCRIPTION
          </a>
          {", "}
          <a target="_blank" href="https://help.apple.com/app-store-connect/#/itcf20f3392e">
            SUBSCRIBER
          </a>
        </>
      ),
      connection: (
        <>
          Generate/Find all requirements using this{" "}
          <a target="_blank" href="https://leapfin.com/blog/apple-appstore-integration/">
            external article
          </a>
          .
        </>
      ),
    },
  },
  {
    pic: logos.asana,
    docker_image_name: "airbyte/source-asana",
    displayName: "Asana",
    stable: false,
    documentation: {
      overview: (
        <>
          This source can sync data for the{" "}
          <a target="_blank" href="https://developers.asana.com/docs">
            Asana API
          </a>
          {": "}
          <a target="_blank" href="https://developers.asana.com/docs/custom-fields">
            Custom fields
          </a>
          {", "}
          <a target="_blank" href="https://developers.asana.com/docs/projects">
            Projects
          </a>
          {", "}
          <a target="_blank" href="https://developers.asana.com/docs/sections">
            Sections
          </a>
          {", "}
          <a target="_blank" href="https://developers.asana.com/docs/stories">
            Stories
          </a>
          {", "}
          <a target="_blank" href="https://developers.asana.com/docs/tags">
            Tags
          </a>
          {", "}
          <a target="_blank" href="https://developers.asana.com/docs/tasks">
            Tasks
          </a>
          {", "}
          <a target="_blank" href="https://developers.asana.com/docs/teams">
            Teams
          </a>
          {", "}
          <a target="_blank" href="https://developers.asana.com/docs/team-memberships">
            Team Memberships
          </a>
          {", "}
          <a target="_blank" href="https://developers.asana.com/docs/users">
            Users
          </a>
          {", "}
          <a target="_blank" href="https://developers.asana.com/docs/workspaces">
            Workspaces
          </a>
        </>
      ),
      connection: (
        <>
          Please follow these{" "}
          <a target="_blank" href="https://developers.asana.com/docs/personal-access-token">
            steps
          </a>{" "}
          to obtain Personal Access Token for your account.
        </>
      ),
    },
  },
  {
    pic: logos.tap_postgresql,
    docker_image_name: "airbyte/source-postgres",
    displayName: "Postgres",
    stable: false,
    documentation: {
      overview: <>The Postgres source can sync tables from Postgres SQL database into destination of your choice.</>,
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/postgres#setup-guide">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.tap_mysql,
    docker_image_name: "airbyte/source-mysql",
    displayName: "MySQL",
    stable: false,
    documentation: mySqlDocumentation,
  },
  {
    pic: logos.file,
    docker_image_name: "airbyte/source-file",
    displayName: "File",
    stable: false,
    documentation: {
      overview: (
        <>
          File are often exchanged or published in various remote locations. This source aims to support an expanding
          range of file formats and storage providers. That is, every time a sync is run, all rows will be copied in the
          file and columns you set up for replication into the destination in a new table.
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/file#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.microsoft_sql_server,
    docker_image_name: "airbyte/source-mssql",
    displayName: "Microsoft SQL Server",
    stable: false,
    documentation: {
      overview: <>Microsoft SQL Server connector pulls data from the remote database.</>,
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/mssql#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.tap_hubspot,
    docker_image_name: "airbyte/source-hubspot",
    displayName: "HubSpot",
    stable: false,
    documentation: {
      overview: (
        <>
          The Hubspot connector can be used to sync your Hubspot data{": "}
          <a target="_blank" href="https://developers.hubspot.com/docs/methods/email/get_campaign_data">
            Campaigns
          </a>
          {", "}
          <a target="_blank" href="https://developers.hubspot.com/docs/api/crm/companies">
            Companies
          </a>
          {", "}
          <a target="_blank" href="http://developers.hubspot.com/docs/methods/lists/get_lists">
            Contact Lists
          </a>
          {", "}
          <a target="_blank" href="https://developers.hubspot.com/docs/methods/contacts/get_contacts">
            Contacts
          </a>
          {", "}
          <a target="_blank" href="https://developers.hubspot.com/docs/methods/pipelines/get_pipelines_for_object_type">
            Deal Pipelines
          </a>
          {", "}
          <a target="_blank" href="https://developers.hubspot.com/docs/api/crm/deals">
            Deals
          </a>
          {", "}
          <a target="_blank" href="https://developers.hubspot.com/docs/methods/email/get_events">
            Email Events
          </a>
          {", "}
          <a target="_blank" href="https://legacydocs.hubspot.com/docs/methods/engagements/get-all-engagements">
            Engagements
          </a>
          {", "}
          <a target="_blank" href="https://developers.hubspot.com/docs/api/marketing/forms">
            Forms
          </a>
          {", "}
          <a target="_blank" href="https://developers.hubspot.com/docs/api/crm/line-items">
            Line Items
          </a>
          {", "}
          <a target="_blank" href="https://developers.hubspot.com/docs/methods/owners/get_owners">
            Owners
          </a>
          {", "}
          <a target="_blank" href="https://developers.hubspot.com/docs/api/crm/products">
            Products
          </a>
          {", "}
          <a target="_blank" href="https://developers.hubspot.com/docs/api/crm/quotes">
            Quotes
          </a>
          {", "}
          <a target="_blank" href="https://developers.hubspot.com/docs/methods/email/get_subscriptions_timeline">
            Subscription Changes
          </a>
          {", "}
          <a target="_blank" href="https://developers.hubspot.com/docs/api/crm/tickets">
            Tickets
          </a>
          {", "}
          <a target="_blank" href="https://legacydocs.hubspot.com/docs/methods/workflows/v3/get_workflows">
            Workflows
          </a>
        </>
      ),
      connection: (
        <>
          This connector supports only authentication with API Key. To obtain API key for the account go to settings
          integrations (under the account banner) api key. If you already have an api key you can use that. Otherwise
          generated a new one. See{" "}
          <a target="_blank" href="https://knowledge.hubspot.com/integrations/how-do-i-get-my-hubspot-api-key">
            docs
          </a>{" "}
          for more details.
        </>
      ),
    },
  },
  {
    pic: logos.tap_salesforce,
    docker_image_name: "airbyte/source-salesforce-singer",
    displayName: "Salesforce",
    stable: false,
    documentation: {
      overview: (
        <>
          The Salesforce source supports syncs{": "} ServiceAppointmentFeed, ThirdPartyAccountLink,
          DataAssessmentFieldMetric, ServiceAppointmentHistory, UserLogin, CampaignFeed, ApexTestRunResult,
          BrandTemplate, ListEmailRecipientSource, Product2, LoginHistory, PricebookEntry, SolutionFeed,
          ServiceAppointment, SiteFeed, PermissionSetAssignment, ServiceResourceFeed, ApexTestResult,
          AssetRelationshipHistory, FieldPermissions, OrgWideEmailAddress, DuplicateRecordSet, DashboardComponentFeed,
          CollaborationGroupMember, ExternalEventMappingShare, UserProvisioningConfig, MessagingSessionFeed,
          ContactFeed, MatchingRuleItem, ContactShare, AsyncApexJob, ApexTrigger, AuthConfigProviders, CampaignHistory,
          UserListViewCriterion, ExternalEvent, AppMenuItem, ContentDocumentHistory, LoginGeo, SamlSsoConfig,
          DatacloudDandBCompany, ServiceTerritoryHistory, OrderShare, EmailDomainKey, KnowledgeableUser,
          PermissionSetGroup, Report, BackgroundOperation, ProcessDefinition, ListEmail, LiveChatSensitiveDataRule,
          PlatformCachePartition, FileSearchActivity, EmbeddedServiceDetail, UserProvMockTarget, ResourcePreferenceFeed,
          QuickText, SecureAgentPlugin, ServiceAppointmentShare, MessagingChannel, ServiceResource, Asset, AuthConfig,
          FiscalYearSettings, SkillRequirement, SkillRequirementHistory, UserPackageLicense, AssociatedLocation,
          ApexEmailNotification, ConnectedApplication, Opportunity, TaskFeed, PermissionSet, RecordType,
          CaseTeamTemplate, OauthToken, CategoryNode, UserProvAccount, MacroShare, CampaignMemberStatus,
          ChatterExtension, Group, StaticResource, MatchingInformation, CollaborationGroup, SetupAuditTrail,
          ProcessNode, CorsWhitelistEntry, CaseContactRole, TestSuiteMembership, LeadShare, CallCenter, LoginEvent,
          DataAssessmentMetric, MobileApplicationDetail, MessagingSession, Domain, Document, ApexClass,
          AssociatedLocationHistory, DatacloudCompany, ResourceAbsenceHistory, ServiceResourceSkill, OpportunityFeed,
          DuplicateRule, LeadFeed, Idea, Organization, OpportunityShare, BusinessProcess, AssetRelationshipFeed,
          FeedComment, UserFeed, ListViewChart, UserAppMenuCustomizationShare, BrandingSetProperty,
          ServiceTerritoryMember, Folder, ContentWorkspacePermission, LeadCleanInfo, ListView, CampaignMember,
          ContentVersion, UserListView, ProcessInstanceWorkitem, ChatterActivity, LocationHistory,
          ContentWorkspaceMember, QuickTextHistory, EventLogFile, MessagingEndUserShare, ContractContactRole, WorkType,
          LeadStatus, QueueSobject, BrandingSet, TodayGoal, CampaignShare, ContractFeed, AccountContactRole,
          MessagingSessionShare, AssetRelationship, OpportunityPartner, MacroHistory, GrantedByLicense,
          CaseTeamTemplateMember, GroupMember, UserProvisioningRequest, ServiceResourceShare, Skill, CaseHistory,
          OrderFeed, WaveCompatibilityCheckItem, Event, LocationShare, TopicAssignment, TopicFeed, ContentDocumentFeed,
          ObjectPermissions, SkillRequirementFeed, FeedItem, AccountHistory, ApexComponent, SetupEntityAccess,
          StreamingChannel, OperatingHours, CaseSolution, Publisher, SiteHistory, ApexPage, AccountShare,
          FlowInterviewShare, Dashboard, CaseTeamRole, AccountPartner, DatacloudAddress, ChatterExtensionConfig,
          OpportunityStage, AuraDefinitionBundleInfo, ResourcePreferenceHistory, UserProvisioningLog,
          ResourceAbsenceFeed, IdpEventLog, ContentDistributionView, CollaborationGroupMemberRequest, DomainSite,
          EventFeed, BusinessHours, SecureAgentsCluster, UserShare, DataAssessmentValueMetric, EntitySubscription,
          VisualforceAccessMetrics, CspTrustedSite, Order, InstalledMobileApp, Location, UserRole, CaseFeed,
          ContentDocument, DuplicateRecordItem, ServiceTerritoryMemberHistory, Scontrol, AssignedResourceFeed, ApexLog,
          CaseTeamMember, DocumentAttachmentMap, ServiceTerritoryMemberFeed, OrderItemFeed, UserAppMenuCustomization,
          OpportunityCompetitor, Product2History, PushTopic, ResourcePreference, WorkTypeHistory, StampAssignment,
          LocationFeed, EmailMessageRelation, OrderHistory, OpportunityLineItem, WorkTypeShare, AccountFeed,
          ContentFolder, LoginIp, OpportunityHistory, Macro, MatchingRule, SecureAgent, AccountCleanInfo,
          SecureAgentPluginProperty, OrderItem, MessagingEndUser, ApexTestQueueItem, QuickTextShare, FeedPollChoice,
          ProcessInstance, CustomPermissionDependency, SecurityCustomBaseline, TenantUsageEntitlement,
          ProcessInstanceStep, ServiceTerritoryShare, SearchPromotionRule, Lead, ClientBrowser, CaseComment,
          DatacloudOwnedEntity, ContentWorkspaceDoc, EmailServicesFunction, Solution, AssetHistory,
          EmailServicesAddress, CustomPermission, PermissionSetGroupComponent, AuraDefinitionInfo,
          UserProvAccountStaging, Note, OpportunityFieldHistory, DandBCompany, MailmergeTemplate, User, AuthProvider,
          FlowInterview, VerificationHistory, AssetFeed, AuthSession, EventRelation, WorkTypeFeed, UserPreference,
          NamedCredential, ServiceResourceSkillHistory, UserProvisioningRequestShare, EmailCapture, CustomBrandAsset,
          Campaign, UserAppInfo, UserPermissionAccess, AdditionalNumber, ContentAsset, ConferenceNumber,
          ServiceTerritory, ActionLinkGroupTemplate, CollaborationInvitation, PermissionSetLicense, ApexTestSuite,
          ExternalEventMapping, TimeSlot, OrderItemHistory, MessagingEndUserHistory, ExternalDataUserAuth,
          AuraDefinition, LeadHistory, ServiceAppointmentStatus, EventBusSubscriber, WebLink, ApexTestResultLimits,
          Profile, CaseTeamTemplateRecord, OpportunityContactRole, CronTrigger, DatacloudContact, ContentWorkspace,
          Period, AssetShare, MessagingLink, Topic, ServiceResourceHistory, Case, EntityDefinition, ResourceAbsence,
          Partner, AssignmentRule, ListEmailShare, ContactHistory, Site, CustomBrand, EmailMessage, Pricebook2History,
          FeedPollVote, ServiceResourceSkillFeed, Account, SessionPermSetActivation, ContractHistory, Holiday,
          EmailTemplate, ActionLinkTemplate, ReportFeed, CollaborationGroupFeed, CustomObjectUserLicenseMetrics,
          FeedAttachment, ContentDistribution, ContentFolderLink, FeedRevision, UserAppMenuItem, ProcessInstanceNode,
          AuraDefinitionBundle, TodayGoalShare, Pricebook2, CategoryData, MacroInstruction, StreamingChannelShare,
          AssignedResource, PackageLicense, Product2Feed, DashboardFeed, Task, UserLicense, SolutionHistory,
          ContentVersionHistory, MessagingSessionHistory, DashboardComponent, CaseShare, PermissionSetLicenseAssign,
          ContactCleanInfo, Contract, Attachment, DatacloudPurchaseUsage, ServiceTerritoryFeed, CronJobDetail,
          ApexPageInfo, PlatformCachePartitionType, Contact, Community, Stamp, OperatingHoursFeed, ExternalDataSource
        </>
      ),
      connection: (
        <>
          We recommend the following{" "}
          <a
            target="_blank"
            href="https://medium.com/@bpmmendis94/obtain-access-refresh-tokens-from-salesforce-rest-api-a324fe4ccd9b"
          >
            walkthrough
          </a>{" "}
          while keeping in mind the edits we suggest below for setting up a Salesforce app that can pull data from
          Salesforce and locating the credentials you need to provide. If your salesforce URL does not take the form{" "}
          <b>X.salesforce.com</b>, use your actual Salesforce domain name. For example, if your Salesforce URL is{" "}
          <b>awesomecompany.force.com</b> then use that instead of <b>awesomecompany.salesforce.com</b>. When running a{" "}
          <b>curl</b> command, always run it with the <b>-L</b> option to follow any redirects.
        </>
      ),
    },
  },
  {
    pic: logos.mailchimp,
    docker_image_name: "airbyte/source-mailchimp",
    displayName: "Mailchimp",
    stable: false,
    documentation: {
      overview: (
        <>
          The Mailchimp connector can be used to sync data from{" "}
          <a target="_blank" href="https://mailchimp.com/developer/api/marketing/lists/get-list-info">
            Mailchimp
          </a>
          {": "}
          <a target="_blank" href="https://mailchimp.com/developer/api/marketing/lists/get-list-info">
            Lists
          </a>
          {", "}
          <a target="_blank" href="https://mailchimp.com/developer/api/marketing/campaigns/get-campaign-info/">
            Campaigns
          </a>
        </>
      ),
      connection: (
        <>
          To start syncing Mailchimp data you'll need : Your Mailchimp username. Often this is just the email address or
          username you use to sign into Mailchimp. A Mailchimp API Key. Follow the{" "}
          <a target="_blank" href="https://mailchimp.com/help/about-api-keys/">
            Mailchimp documentation for generating an API key
          </a>
          .
        </>
      ),
    },
  },
  {
    pic: logos.tap_jira,
    docker_image_name: "airbyte/source-jira",
    displayName: "Jira",
    stable: false,
    documentation: {
      overview: (
        <>
          The Jira source supports sync the following streams{": "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-application-roles/#api-rest-api-3-applicationrole-get"
          >
            Application roles
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-avatars/#api-rest-api-3-avatar-type-system-get"
          >
            Avatars
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-dashboards/#api-rest-api-3-dashboard-get"
          >
            Dashboards
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-filters/#api-rest-api-3-filter-search-get"
          >
            Filters
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-filter-sharing/#api-rest-api-3-filter-id-permission-get"
          >
            Filters
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-filter-sharing/#api-rest-api-3-filter-id-permission-get"
          >
            Filter sharing
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-groups/#api-rest-api-3-groups-picker-get"
          >
            Groups
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-get"
          >
            Issues
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/#api-rest-api-3-issue-issueidorkey-comment-get"
          >
            Issue comments
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-fields/#api-rest-api-3-field-get"
          >
            Issue fields
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-field-configurations/#api-rest-api-3-fieldconfiguration-get"
          >
            Issue field configurations
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-custom-field-contexts/#api-rest-api-3-field-fieldid-context-get"
          >
            Issue custom field contexts
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-link-types/#api-rest-api-3-issuelinktype-get"
          >
            Issue link types
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-navigator-settings/#api-rest-api-3-settings-columns-get"
          >
            Issue navigator settings
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-notification-schemes/#api-rest-api-3-notificationscheme-get"
          >
            Issue notification schemes
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-priorities/#api-rest-api-3-priority-get"
          >
            Issue priorities
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-properties/#api-rest-api-3-issue-issueidorkey-properties-propertykey-get"
          >
            Issue properties
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-remote-links/#api-rest-api-3-issue-issueidorkey-remotelink-get"
          >
            Issue remote links
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-resolutions/#api-rest-api-3-resolution-get"
          >
            Issue resolutions
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-security-schemes/#api-rest-api-3-issuesecurityschemes-get"
          >
            Issue security schemes
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-type-schemes/#api-rest-api-3-issuetypescheme-get"
          >
            Issue type schemes
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-type-screen-schemes/#api-rest-api-3-issuetypescreenscheme-get"
          >
            Issue type screen schemes
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-votes/#api-group-issue-votes"
          >
            Issue votes
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-watchers/#api-rest-api-3-issue-issueidorkey-watchers-get"
          >
            Issue watchers
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-worklogs/#api-rest-api-3-issue-issueidorkey-worklog-get"
          >
            Issue worklogs
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-jira-settings/#api-rest-api-3-application-properties-get"
          >
            Jira settings
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-labels/#api-rest-api-3-label-get"
          >
            Labels
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-permissions/#api-rest-api-3-mypermissions-get"
          >
            Permissions
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-permission-schemes/#api-rest-api-3-permissionscheme-get"
          >
            Permission schemes
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/#api-rest-api-3-project-search-get"
          >
            Projects
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-project-avatars/#api-rest-api-3-project-projectidorkey-avatars-get"
          >
            Project avatars
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-project-categories/#api-rest-api-3-projectcategory-get"
          >
            Project categories
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-project-components/#api-rest-api-3-project-projectidorkey-component-get"
          >
            Project components
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-project-email/#api-rest-api-3-project-projectid-email-get"
          >
            Project email
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-project-permission-schemes/#api-group-project-permission-schemes"
          >
            Project permission schemes
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-project-types/#api-rest-api-3-project-type-get"
          >
            Project types
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-project-versions/#api-rest-api-3-project-projectidorkey-version-get"
          >
            Project versions
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-screens/#api-rest-api-3-screens-get"
          >
            Screens
          </a>
          {", "}
          <a target="_blank" href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-screen-tabs/">
            Screen tabs
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-screen-tab-fields/#api-rest-api-3-screens-screenid-tabs-tabid-fields-get"
          >
            Screen tab fields
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-screen-schemes/#api-rest-api-3-screenscheme-get"
          >
            Screen schemes
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-time-tracking/#api-rest-api-3-configuration-timetracking-list-get"
          >
            Time tracking
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-user-search/#api-rest-api-3-user-search-get"
          >
            Users
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-workflows/#api-rest-api-3-workflow-search-get"
          >
            Workflows
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-workflow-schemes/#api-rest-api-3-workflowscheme-get"
          >
            Workflow schemes
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-workflow-statuses/#api-rest-api-3-status-get"
          >
            Workflow statuses
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-workflow-status-categories/#api-rest-api-3-statuscategory-get"
          >
            Workflow status categories
          </a>
        </>
      ),
      connection: (
        <>
          Please follow the{" "}
          <a target="_blank" href="https://confluence.atlassian.com/cloud/api-tokens-938839638.html">
            Jira confluence for generating an API token
          </a>
          .
        </>
      ),
    },
  },
  {
    pic: logos.tap_stripe,
    docker_image_name: "airbyte/source-stripe",
    displayName: "Stripe",
    stable: false,
    documentation: stripeDocumentation,
  },
  {
    pic: logos.tap_shopify,
    docker_image_name: "airbyte/source-shopify",
    displayName: "Shopify",
    stable: false,
    documentation: shopifyDocumentation,
  },
  {
    pic: logos.google_adwords,
    docker_image_name: "airbyte/source-google-adwords-singer",
    displayName: "Google AdWords",
    stable: false,
    documentation: {
      overview: <>The Adwords source syncs data from Google AdWords: accounts, campaigns, ads, etc.</>,
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/google-adwords#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.redshift,
    docker_image_name: "airbyte/source-redshift",
    displayName: "Redshift",
    stable: false,
    documentation: {
      overview: <>Redshift connector pulls data from the remote database.</>,
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/redshift#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.tap_google_ads,
    docker_image_name: "airbyte/source-google-ads",
    displayName: "Google Ads",
    hasNativeEquivalent: true,
    stable: false,
    documentation: {
      overview: (
        <>
          This source can sync data for the{" "}
          <a target="_blank" href="https://developers.google.com/google-ads/api/fields/v8/overview">
            Google Ads
          </a>
          {": "}
          <a target="_blank" href="https://developers.google.com/google-ads/api/fields/v8/customer">
            accounts
          </a>
          {", "}
          <a target="_blank" href="https://developers.google.com/google-ads/api/fields/v8/campaign">
            campaigns
          </a>
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/google-ads">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.instagram,
    docker_image_name: "airbyte/source-instagram",
    displayName: "Instagram",
    stable: false,
    documentation: {
      overview: (
        <>
          This source can sync data for the Instagram Business Account available in the Facebook Graph API{": "}
          <a target="_blank" href="https://developers.facebook.com/docs/instagram-api/reference/ig-user">
            User
          </a>
          {", "}
          <a target="_blank" href="https://developers.facebook.com/docs/instagram-api/reference/ig-user/insights">
            User Insights
          </a>
          {", "}
          <a target="_blank" href="https://developers.facebook.com/docs/instagram-api/reference/ig-user/media">
            Media
          </a>
          {", "}
          <a target="_blank" href="https://developers.facebook.com/docs/instagram-api/reference/ig-media/insights">
            Media Insights
          </a>
          {", "}
          <a target="_blank" href="https://developers.facebook.com/docs/instagram-api/reference/ig-user/stories/">
            Stories
          </a>
          {", "}
          <a target="_blank" href="https://developers.facebook.com/docs/instagram-api/reference/ig-media/insights">
            Story Insights
          </a>
          {", "}
          <a target="_blank" href="https://developers.facebook.com/docs/instagram-api/">
            Instagram API
          </a>
          {", "}
          <a target="_blank" href="https://developers.facebook.com/docs/instagram-api/guides/insights/">
            Instagram Insights API documentation
          </a>
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/instagram#setup-guide">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.freshdesk,
    docker_image_name: "airbyte/source-freshdesk",
    displayName: "Freshdesk",
    stable: false,
    documentation: {
      overview: (
        <>
          The Freshdesk source syncs the following streams{": "}
          <a target="_blank" href="https://developers.freshdesk.com/api/#agents">
            Agents
          </a>
          {", "}
          <a target="_blank" href="https://developers.freshdesk.com/api/#companies">
            Companies
          </a>
          {", "}
          <a target="_blank" href="https://developers.freshdesk.com/api/#contacts">
            Contacts
          </a>
          {", "}
          <a target="_blank" href="https://developers.freshdesk.com/api/#conversations">
            Conversations
          </a>
          {", "}
          <a target="_blank" href="https://developers.freshdesk.com/api/#groups">
            Groups
          </a>
          {", "}
          <a target="_blank" href="https://developers.freshdesk.com/api/#roles">
            Roles
          </a>
          {", "}
          <a target="_blank" href="https://developers.freshdesk.com/api/#satisfaction-ratings">
            Satisfaction Ratings
          </a>
          {", "}
          <a target="_blank" href="https://developers.freshdesk.com/api/#skills">
            Skills
          </a>
          {", "}
          <a target="_blank" href="https://developers.freshdesk.com/api/#surveys">
            Surveys
          </a>
          {", "}
          <a target="_blank" href="https://developers.freshdesk.com/api/#tickets">
            Tickets
          </a>
          {", "}
          <a target="_blank" href="https://developers.freshdesk.com/api/#time-entries">
            Time Entries
          </a>
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://support.freshdesk.com/support/solutions/articles/215517">
            How to find your API key
          </a>
          .
        </>
      ),
    },
  },
  {
    pic: logos.mongodb,
    docker_image_name: "airbyte/source-mongodb",
    displayName: "Mongo DB (v1 deprecated)",
    deprecated: true,
    stable: false,
    documentation: {
      overview: <>MongoDB connector pulls data from the remote database.</>,
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/mongodb#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.mongodb,
    docker_image_name: "airbyte/source-mongodb-v2",
    displayName: "Mongo DB",
    stable: false,
    documentation: {
      overview: <>MongoDB connector pulls data from the remote database.</>,
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/mongodb#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.tap_zoom,
    docker_image_name: "airbyte/source-zoom-singer",
    displayName: "Zoom (Old version)",
    deprecated: true,

    stable: false,
    documentation: {
      overview: (
        <>
          The Zoom source syncs the following streams{": "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/users/users">
            Users
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/meetings/meetings">
            Meetings
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/meetings/meetingregistrants">
            Meeting Registrants
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/meetings/meetingpolls">
            Meeting Polls
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/meetings/listpastmeetingpolls"
          >
            Meeting Poll Results
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/meetings/meetingregistrantsquestionsget"
          >
            Meeting Questions
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/deprecated-api-endpoints/listpastmeetingfiles"
          >
            Meeting Files
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/webinars/webinars">
            Webinars
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/webinars/webinarpanelists">
            Webinar Panelists
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/webinars/webinarregistrants">
            Webinar Registrants
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/webinars/webinarabsentees">
            Webinar Absentees
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/webinars/webinarpolls">
            Webinar Polls
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/webinars/listpastwebinarpollresults"
          >
            Webinar Poll Results
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/webinars/webinarregistrantsquestionsget"
          >
            Webinar Questions
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/webinars/gettrackingsources">
            Webinar Tracking Sources
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/deprecated-api-endpoints/listpastwebinarfiles"
          >
            Webinar Files
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/reports/reportmeetingdetails"
          >
            Report Meetings
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/reports/reportmeetingparticipants"
          >
            Report Meeting Participants
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/reports/reportwebinardetails"
          >
            Report Webinars
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/reports/reportwebinarparticipants"
          >
            Report Webinar Participants
          </a>
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/guides/build/jwt-app">
            How to generate your JWT Token
          </a>
        </>
      ),
    },
  },
  {
    pic: logos.tap_zoom,
    docker_image_name: "airbyte/source-zoom",
    displayName: "Zoom",
    stable: false,
    documentation: {
      overview: (
        <>
          The Zoom source syncs the following streams{": "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/users/users">
            Users
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/meetings/meetings">
            Meetings
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/meetings/meetingregistrants">
            Meeting Registrants
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/meetings/meetingpolls">
            Meeting Polls
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/meetings/listpastmeetingpolls"
          >
            Meeting Poll Results
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/meetings/meetingregistrantsquestionsget"
          >
            Meeting Questions
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/deprecated-api-endpoints/listpastmeetingfiles"
          >
            Meeting Files
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/webinars/webinars">
            Webinars
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/webinars/webinarpanelists">
            Webinar Panelists
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/webinars/webinarregistrants">
            Webinar Registrants
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/webinars/webinarabsentees">
            Webinar Absentees
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/webinars/webinarpolls">
            Webinar Polls
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/webinars/listpastwebinarpollresults"
          >
            Webinar Poll Results
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/webinars/webinarregistrantsquestionsget"
          >
            Webinar Questions
          </a>
          {", "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/api-reference/zoom-api/webinars/gettrackingsources">
            Webinar Tracking Sources
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/deprecated-api-endpoints/listpastwebinarfiles"
          >
            Webinar Files
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/reports/reportmeetingdetails"
          >
            Report Meetings
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/reports/reportmeetingparticipants"
          >
            Report Meeting Participants
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/reports/reportwebinardetails"
          >
            Report Webinars
          </a>
          {", "}
          <a
            target="_blank"
            href="https://marketplace.zoom.us/docs/api-reference/zoom-api/reports/reportwebinarparticipants"
          >
            Report Webinar Participants
          </a>
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://marketplace.zoom.us/docs/guides/build/jwt-app">
            How to generate your JWT Token
          </a>
        </>
      ),
    },
  },
  {
    pic: logos.tap_sendgrid_core,
    docker_image_name: "airbyte/source-sendgrid",
    displayName: "Sendgrid",
    stable: false,
    documentation: {
      overview: (
        <>
          The Sendgrid source syncs campaigns and lists streams. There are two different kinds of marketing campaigns,
          "legacy marketing campaigns" and "new marketing campaigns". Only "new marketing campaigns" are supported.
        </>
      ),
      connection: (
        <>
          Generate a API key using the{" "}
          <a target="_blank" href="https://sendgrid.com/docs/ui/account-and-settings/api-keys/#creating-an-api-key">
            Sendgrid documentation
          </a>
          . We recommend creating a key specifically for access. This will allow you to control which resources should
          be able to access. The API key should be read-only on all resources except Marketing, where it needs Full
          Access.
        </>
      ),
    },
  },
  {
    pic: logos.tap_github,
    docker_image_name: "airbyte/source-github",
    displayName: "GitHub",
    stable: false,
    documentation: githubDocumentation,
  },
  {
    pic: logos.tap_marketo,
    docker_image_name: "airbyte/source-marketo-singer",
    displayName: "Marketo",
    stable: false,
    documentation: {
      overview: (
        <>
          The Marketo source syncs the following tables from Marketo{": "}
          <a
            target="_blank"
            href="https://developers.marketo.com/rest-api/endpoint-reference/lead-database-endpoint-reference/#!/Activities/getLeadActivitiesUsingGET"
          >
            activities_X
          </a>{" "}
          {", "}
          <a
            target="_blank"
            href="https://developers.marketo.com/rest-api/endpoint-reference/lead-database-endpoint-reference/#!/Activities/getAllActivityTypesUsingGET"
          >
            activity_types
          </a>{" "}
          {", "}
          <a
            target="_blank"
            href="https://developers.marketo.com/rest-api/endpoint-reference/lead-database-endpoint-reference/#!/Campaigns/getCampaignsUsingGET"
          >
            campaigns
          </a>{" "}
          {", "}
          <a
            target="_blank"
            href="https://developers.marketo.com/rest-api/endpoint-reference/lead-database-endpoint-reference/#!/Leads/getLeadByIdUsingGET"
          >
            leads
          </a>{" "}
          {", "}
          <a
            target="_blank"
            href="https://developers.marketo.com/rest-api/endpoint-reference/lead-database-endpoint-reference/#!/Static_Lists/getListByIdUsingGET"
          >
            lists
          </a>{" "}
          {", "}
          <a
            target="_blank"
            href="https://developers.marketo.com/rest-api/endpoint-reference/asset-endpoint-reference/#!/Programs/browseProgramsUsingGET"
          >
            programs
          </a>{" "}
          {", "}
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://support.freshdesk.com/support/solutions/articles/215517">
            https://docs.airbyte.io/integrations/sources/marketo#getting-started
          </a>
          .
        </>
      ),
    },
  },
  {
    pic: logos.tap_looker,
    docker_image_name: "airbyte/source-looker",
    displayName: "Looker",
    stable: false,
    documentation: {
      overview: (
        <>
          The Looker source syncs the following streams{": "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/color-collection#get_all_color_collections"
          >
            Color Collections
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/connection#get_all_connections"
          >
            Connections
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/content#get_all_content_metadatas"
          >
            Content Metadata
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/content#get_all_content_metadata_accesses"
          >
            Content Metadata Access
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/dashboard#get_all_dashboards"
          >
            Dashboards
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/dashboard#get_all_dashboardelements"
          >
            Dashboard Elements
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/dashboard#get_all_dashboard_filters"
          >
            Dashboard Filters
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/dashboard#get_all_dashboardlayouts"
          >
            Dashboard Layouts
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/datagroup#get_all_datagroups"
          >
            Datagroups
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/folder#get_all_folders"
          >
            Folders
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/group#get_all_groups"
          >
            Groups
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/homepage#get_all_homepages"
          >
            Homepages
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/integration#get_all_integration_hubs"
          >
            Integration Hubs
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/integration#get_all_integrations"
          >
            Integrations
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/dashboard#get_all_dashboards"
          >
            Lookml Dashboards
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/lookml-model#get_all_lookml_models"
          >
            Lookml Models
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/look#get_all_looks"
          >
            Looks
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/look#run_look"
          >
            Run Look
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/project#get_all_projects"
          >
            Projects
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/project#get_all_project_files"
          >
            Project Files
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/project#get_all_git_branches"
          >
            Git Branches
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/query#run_query"
          >
            Query History
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/role#get_all_roles"
          >
            Roles
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/role#get_all_model_sets"
          >
            Model Sets
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/role#get_all_permission_sets"
          >
            Permission Sets
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/role#get_all_permissions"
          >
            Permissions
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/role#get_role_groups"
          >
            Role Groups
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/scheduled-plan#get_all_scheduled_plans"
          >
            Scheduled Plans
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/space#get_all_spaces"
          >
            Spaces
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/user-attribute#get_all_user_attributes"
          >
            User Attributes
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/user-attribute#get_user_attribute_group_values"
          >
            User Attribute Group Value
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/auth#get_all_user_login_lockouts"
          >
            User Login Lockouts
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/user#get_all_users"
          >
            Users
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/user#get_user_attribute_values"
          >
            User Attribute Values
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/user#get_all_web_login_sessions"
          >
            User Sessions
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/config#get_apiversion"
          >
            Versions
          </a>
          {", "}
          <a target="_blank" href="https://docs.looker.com/reference/api-and-integration/api-reference/v3.1/workspace">
            Workspaces
          </a>
        </>
      ),
      connection: (
        <>
          Please read the "API3 Key" section in{" "}
          <a target="_blank" href="https://docs.looker.com/admin-options/settings/users">
            Looker's information for users docs
          </a>{" "}
          for instructions on how to generate Client Id and Client Secret.
        </>
      ),
    },
  },
  {
    pic: logos.tap_oracle,
    docker_image_name: "airbyte/source-oracle",
    displayName: "Oracle DB",
    stable: false,
    documentation: {
      overview: <>Oracle connector pulls data from the remote database.</>,
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/oracle#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.tap_exchange_rates_api,
    docker_image_name: "airbyte/source-exchange-rates",
    displayName: "Exchange Rates API",
    stable: false,
    documentation: {
      overview: (
        <>
          The exchange rates integration pulls all its data from{" "}
          <a target="_blank" href="https://exchangeratesapi.io">
            exchangeratesapi.io
          </a>
          {": "}
          <a
            target="_blank"
            href="https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html"
          >
            currency
          </a>
        </>
      ),
      connection: (
        <>
          In order to get an API Access Key please go to{" "}
          <a target="_blank" href="https://manage.exchangeratesapi.io/signup/free">
            this
          </a>{" "}
          page and enter needed info. After registration and login you will see your API Access Key, also you may find
          it{" "}
          <a target="_blank" href="https://manage.exchangeratesapi.io/dashboard">
            here
          </a>
          .If you have free subscription plan (you may check it{" "}
          <a target="_blank" href="https://manage.exchangeratesapi.io/plan">
            here
          </a>
          ) this means that you will have 2 limitations: 1000 API calls per month and You won't be able to specify the
          bas` parameter, meaning that you will be dealing only with default base value which is EUR.
        </>
      ),
    },
  },
  {
    pic: logos.quickbooks,
    docker_image_name: "airbyte/source-quickbooks-singer",
    displayName: "Quickbooks",
    stable: false,
    documentation: {
      overview: (
        <>
          The Quickbooks source syncs the following streams{": "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/account"
          >
            Streams
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account"
          >
            Accounts
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/billpayment"
          >
            BillPayments
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/budget"
          >
            Budgets
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/bill"
          >
            Bills
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/class"
          >
            Classes
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/creditmemo"
          >
            CreditMemos
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer"
          >
            Customers
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/department"
          >
            Departments
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/deposit"
          >
            Deposits
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/employee"
          >
            Employees
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/estimate"
          >
            Estimates
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice"
          >
            Invoices
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/item"
          >
            Items
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/journalentry"
          >
            JournalEntries
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/payment"
          >
            Payments
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/paymentmethod"
          >
            PaymentMethods
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/purchase"
          >
            Purchases
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/purchaseorder"
          >
            PurchaseOrders
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/refundreceipt"
          >
            RefundReceipts
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/salesreceipt"
          >
            SalesReceipts
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/taxagency"
          >
            TaxAgencies
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/taxcode"
          >
            TaxCodes
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/taxrate"
          >
            TaxRates
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/term"
          >
            Terms
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/timeactivity"
          >
            TimeActivities
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/transfer"
          >
            Transfers
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/vendorcredit"
          >
            VendorCredits
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/vendor"
          >
            Vendors
          </a>
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/quickbooks#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.tap_recurly,
    docker_image_name: "airbyte/source-recurly",
    displayName: "Recurly",
    stable: false,
    documentation: {
      overview: (
        <>
          The Recurly source syncs the following streams{": "}
          <a target="_blank" href="https://docs.recurly.com/docs/accounts">
            Accounts
          </a>
          {", "}
          <a target="_blank" href="https://docs.recurly.com/docs/coupons">
            Coupons
          </a>
          {", "}
          <a target="_blank" href="https://docs.recurly.com/docs/invoices">
            Invoices
          </a>
          {", "}
          <a target="_blank" href="https://docs.recurly.com/docs/plans">
            Plans
          </a>
          {", "}
          <a target="_blank" href="https://docs.recurly.com/docs/subscriptions">
            Subscriptions
          </a>
          {", "}
          <a target="_blank" href="https://docs.recurly.com/docs/transactions">
            Transactions
          </a>
        </>
      ),
      connection: (
        <>
          Generate a API key using the{" "}
          <a target="_blank" href="https://docs.recurly.com/docs/api-keys#section-find-or-generate-your-api-key">
            Recurly documentation
          </a>
          . We recommend creating a restricted, read-only key specifically for access. This will allow you to control
          which resources should be able to access.
        </>
      ),
    },
  },
  {
    pic: logos.greenhouse,
    docker_image_name: "airbyte/source-greenhouse",
    displayName: "Greenhouse",
    stable: false,
    documentation: {
      overview: (
        <>
          The Greenhouse source syncs the following streams{": "}
          <a target="_blank" href="https://developers.greenhouse.io/harvest.html#applications">
            Applications
          </a>
          {", "}
          <a target="_blank" href="https://developers.greenhouse.io/harvest.html#candidates">
            Candidates
          </a>
          {", "}
          <a target="_blank" href="https://developers.greenhouse.io/harvest.html#close-reasons">
            Close Reasons
          </a>
          {", "}
          <a target="_blank" href="https://developers.greenhouse.io/harvest.html#custom-fields">
            Custom Fields
          </a>
          {", "}
          <a target="_blank" href="https://developers.greenhouse.io/harvest.html#get-list-degrees">
            Degrees
          </a>
          {", "}
          <a target="_blank" href="https://developers.greenhouse.io/harvest.html#departments">
            Departments
          </a>
          {", "}
          <a target="_blank" href="https://developers.greenhouse.io/harvest.html#job-posts">
            Job Posts
          </a>
          {", "}
          <a target="_blank" href="https://developers.greenhouse.io/harvest.html#jobs">
            Jobs
          </a>
          {", "}
          <a target="_blank" href="https://developers.greenhouse.io/harvest.html#offers">
            Offers
          </a>
          {", "}
          <a target="_blank" href="https://developers.greenhouse.io/harvest.html#scorecards">
            Scorecards
          </a>
          {", "}
          <a target="_blank" href="https://developers.greenhouse.io/harvest.html#users">
            Users
          </a>
        </>
      ),
      connection: (
        <>
          Please follow the{" "}
          <a target="_blank" href="https://developers.greenhouse.io/harvest.html#authentication">
            Greenhouse documentation for generating an API key
          </a>
          .
        </>
      ),
    },
  },
  {
    pic: logos.tap_google_search_console,
    docker_image_name: "airbyte/source-google-search-console-singer",
    displayName: "Google Search Console",
    stable: false,
    documentation: {
      overview: (
        <>
          The Google Search Console source syncs the following streams{": "}
          <a
            target="_blank"
            href="https://developers.google.com/webmaster-tools/search-console-api-original/v3/sites/get"
          >
            Sites
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developers.google.com/webmaster-tools/search-console-api-original/v3/sitemaps/list"
          >
            Sitemaps
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developers.google.com/webmaster-tools/search-console-api-original/v3/searchanalytics/query"
          >
            Performance report country
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developers.google.com/webmaster-tools/search-console-api-original/v3/searchanalytics/query"
          >
            Performance report custom
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developers.google.com/webmaster-tools/search-console-api-original/v3/searchanalytics/query"
          >
            Performance report date
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developers.google.com/webmaster-tools/search-console-api-original/v3/searchanalytics/query"
          >
            Performance report device
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developers.google.com/webmaster-tools/search-console-api-original/v3/searchanalytics/query"
          >
            Performance report page
          </a>
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/google-search-console#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.microsoft_teams,
    docker_image_name: "airbyte/source-microsoft-teams",
    displayName: "Microsoft teams",
    stable: false,
    documentation: {
      overview: (
        <>
          This source can sync data for the Microsoft Graph API to work with{" "}
          <a target="_blank" href="https://docs.microsoft.com/en-us/graph/teams-concept-overview">
            Microsoft Teams
          </a>
          . There are currently 2 versions of{" "}
          <a target="_blank" href="https://docs.microsoft.com/en-us/graph/versioning-and-support">
            Microsoft Graph REST APIs
          </a>{" "}
          - v1.0 and beta. Beta version contains new or enhanced APIs that are still in preview status. But APIs in
          preview status are subject to change, and may break existing scenarios without notice. It isn't recommended
          taking a production dependency on APIs in the beta endpoint. This Source Connector is based on a{" "}
          <a
            target="_blank"
            href="https://docs.microsoft.com/en-us/graph/api/resources/teams-api-overview?view=graph-rest-1.0"
          >
            API v1.0
          </a>{" "}
          and it syncs the following streams{": "}
          <a target="_blank" href="https://docs.microsoft.com/en-us/graph/api/user-list?view=graph-rest-beta&tabs=http">
            users
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.microsoft.com/en-us/graph/teams-list-all-teams?context=graph%2Fapi%2F1.0&view=graph-rest-1.0"
          >
            groups
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.microsoft.com/en-us/graph/api/group-list-members?view=graph-rest-1.0&tabs=http"
          >
            group_members
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.microsoft.com/en-us/graph/api/group-list-owners?view=graph-rest-1.0&tabs=http"
          >
            group_owners
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.microsoft.com/en-us/graph/api/channel-list?view=graph-rest-1.0&tabs=http"
          >
            channels
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.microsoft.com/en-us/graph/api/channel-list-members?view=graph-rest-1.0&tabs=http"
          >
            channel_members
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.microsoft.com/en-us/graph/api/channel-list-tabs?view=graph-rest-1.0&tabs=http"
          >
            channel_tabs
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.microsoft.com/en-us/graph/api/group-list-conversations?view=graph-rest-beta&tabs=http"
          >
            conversations
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.microsoft.com/en-us/graph/api/conversation-list-threads?view=graph-rest-beta&tabs=http"
          >
            conversation_threads
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.microsoft.com/en-us/graph/api/conversationthread-list-posts?view=graph-rest-beta&tabs=http"
          >
            conversation_posts
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.microsoft.com/en-us/graph/api/drive-get?view=graph-rest-beta&tabs=http#get-the-document-library-associated-with-a-group"
          >
            team_drives
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.microsoft.com/en-us/graph/api/reportroot-getteamsdeviceusageuserdetail?view=graph-rest-1.0"
          >
            team_device_usage_report
          </a>{" "}
          Some APIs aren't supported in v1.0, e.g. channel messages and channel messages replies.
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/microsoft-teams#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.posthog,
    docker_image_name: "airbyte/source-posthog",
    displayName: "PostHog",
    stable: false,
    documentation: {
      overview: (
        <>
          This source can sync data for the{" "}
          <a target="_blank" href="https://posthog.com/docs/api/overview">
            PostHog API
          </a>
          . {": "}
          <a target="_blank" href="https://posthog.com/docs/api/annotations">
            Annotations
          </a>
          {", "}
          <a target="_blank" href="https://posthog.com/docs/api/cohorts">
            Cohorts
          </a>
          {", "}
          <a target="_blank" href="https://posthog.com/docs/api/events">
            Events
          </a>
          {", "}
          <a target="_blank" href="https://posthog.com/docs/api/feature-flags">
            FeatureFlags
          </a>
          {", "}
          <a target="_blank" href="https://posthog.com/docs/api/insights">
            Insights
          </a>
          {", "}
          <a target="_blank" href="https://posthog.com/docs/api/insights">
            InsightsPath
          </a>
          {", "}
          <a target="_blank" href="https://posthog.com/docs/api/insights">
            InsightsSessions
          </a>
          {", "}
          <a target="_blank" href="https://posthog.com/docs/api/people">
            Persons
          </a>
          {", "}
          <a target="_blank" href="https://posthog.com/docs/api/insights">
            Trends
          </a>
        </>
      ),
      connection: (
        <>
          Please follow these{" "}
          <a target="_blank" href="https://posthog.com/docs/api/overview#how-to-obtain-a-personal-api-key">
            steps
          </a>{" "}
          to obtain Private API Key for your account.
        </>
      ),
    },
  },
  {
    pic: logos.pokeapi,
    docker_image_name: "airbyte/source-pokeapi",
    displayName: "PokeAPI",
    stable: false,
    documentation: {
      overview: (
        <>
          The PokéAPI source uses the fully open{" "}
          <a target="_blank" href="https://pokeapi.co/docs/v2#info">
            PokéAPI
          </a>{" "}
          to serve and retrieve information about Pokémon. This connector should be primarily used for educational
          purposes or for getting a trial source up and running without needing any dependencies. Schema is located{" "}
          <a
            target="_blank"
            href="https://github.com/airbytehq/airbyte/tree/master/airbyte-integrations/connectors/source-pokeapi/source_pokeapi/schemas/pokemon.json"
          >
            here
          </a>
        </>
      ),
      connection: (
        <>
          As this API is fully open and is not rate-limited, no authentication or rate-limiting is performed, so you can
          use this connector right out of the box without any further configuration.
        </>
      ),
    },
  },
  {
    pic: logos.google_workspace,
    docker_image_name: "airbyte/source-google-workspace-admin-reports",
    displayName: "Google Workspace Admin Reports",
    stable: false,
    documentation: {
      overview: (
        <>
          This source syncs data from{" "}
          <a target="_blank" href="https://developers.google.com/admin-sdk/reports/v1/get-start/getting-started">
            Reports API
          </a>
          . For gaining insights on content management with Google Drive activity reports and Audit administrator
          actions. It supports the following streams{": "}
          <a target="_blank" href="https://developers.google.com/admin-sdk/reports/v1/guides/manage-audit-admin">
            admin
          </a>
          {", "}
          <a target="_blank" href="https://developers.google.com/admin-sdk/reports/v1/guides/manage-audit-drive">
            drive
          </a>
          {", "}
          <a target="_blank" href="https://developers.google.com/admin-sdk/reports/v1/guides/manage-audit-login">
            logins
          </a>
          {", "}
          <a target="_blank" href="https://developers.google.com/admin-sdk/reports/v1/guides/manage-audit-mobile">
            mobile
          </a>
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a
            target="_blank"
            href="https://docs.airbyte.io/integrations/sources/google-workspace-admin-reports#getting-started"
          >
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.google,
    docker_image_name: "airbyte/source-google-directory",
    displayName: "Google Directory",
    stable: false,
    documentation: {
      overview: (
        <>
          The Directory source syncs data from
          <a target="_blank" href="https://developers.google.com/admin-sdk/directory/v1/get-start/getting-started">
            Google Directory API
          </a>
          {": "}
          <a
            target="_blank"
            href="https://developers.google.com/admin-sdk/directory/v1/guides/manage-users#get_all_users"
          >
            users
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developers.google.com/admin-sdk/directory/v1/guides/manage-groups#get_all_domain_groups"
          >
            groups
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developers.google.com/admin-sdk/directory/v1/guides/manage-group-members#get_all_members"
          >
            group members
          </a>
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/google-directory#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.clickhouse,
    docker_image_name: "airbyte/source-clickhouse",
    displayName: "ClickHouse",
    stable: false,
    documentation: {
      overview: <>ClickHouse connector pulls data from the remote database.</>,
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/clickhouse#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.drift,
    docker_image_name: "airbyte/source-drift",
    displayName: "Drift",
    stable: false,
    documentation: {
      overview: (
        <>
          The Drift source syncs the following streams{": "}
          <a target="_blank" href="https://devdocs.drift.com/docs/account-model">
            Accounts
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.drift.com/docs/conversation-model">
            Conversations
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.drift.com/docs/user-model">
            Users
          </a>
        </>
      ),
      connection: (
        <>
          Follow Drift's{" "}
          <a target="_blank" href="https://devdocs.drift.com/docs/quick-start">
            Setting Things Up{" "}
          </a>
          guide for a more detailed description of how to obtain the API token.
        </>
      ),
    },
  },
  {
    pic: logos.tap_slack,
    docker_image_name: "airbyte/source-slack",
    displayName: "Slack",
    stable: false,
    documentation: slackDocumentation,
  },
  {
    pic: logos.tap_zendesk_chat,
    docker_image_name: "airbyte/source-zendesk-chat",
    displayName: "Zendesk Chat",
    stable: false,
    documentation: {
      overview: (
        <>
          The Zendesk syncs data from{" "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/chat/introduction">
            Zendesk Chat API
          </a>
          {": "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/chat/accounts#show-account">
            Accounts
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/chat/agents#list-agents">
            Agents
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.zendesk.com/rest_api/docs/chat/incremental_export#incremental-agent-timeline-export"
          >
            Agent Timelines
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/chat/chats#list-chats">
            Chats
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/chat/shortcuts#list-shortcuts">
            Shortcuts
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/chat/triggers#list-triggers">
            Triggers
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/chat/bans#list-bans">
            Bans
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/chat/departments#list-departments">
            Departments
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/chat/goals#list-goals">
            Goals
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/chat/skills#list-skills">
            Skills
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/chat/roles#list-roles">
            Roles
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.zendesk.com/rest_api/docs/chat/routing_settings#show-account-routing-settings"
          >
            Routing Settings
          </a>
        </>
      ),
      connection: (
        <>
          Generate a Access Token as described in{" "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/chat/auth">
            Zendesk Chat docs
          </a>
          . We recommend creating a restricted, read-only key specifically for access. This will allow you to control
          which resources should be able to access.
        </>
      ),
    },
  },
  {
    pic: logos.smartsheet,
    docker_image_name: "airbyte/source-smartsheets",
    displayName: "Smartsheets",
    stable: false,
    documentation: {
      overview: (
        <>
          The Smartsheet Source is written to pull data from a single Smartsheet spreadsheet. Unlike Google Sheets,
          Smartsheets only allows one sheet per Smartsheet - so a given connector instance can sync only one sheet at a
          time. To replicate multiple spreadsheets, you can create multiple instances of the Smartsheet Source, reusing
          the API token for all your sheets that you need to sync.
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/smartsheets#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.plaid,
    docker_image_name: "airbyte/source-plaid",
    displayName: "Plaid",
    stable: false,
    documentation: {
      overview: (
        <>
          The Plaid source syncs data from the balances endpoint{": "}
          <a target="_blank" href="https://plaid.com/docs/api/products/#balance">
            Balance
          </a>
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/plaid#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.tap_s3_csv,
    docker_image_name: "airbyte/source-s3",
    displayName: "S3",
    stable: false,
    documentation: {
      overview: (
        <>
          The S3 source enables syncing of file-based tables with support for multiple files using glob-like pattern
          matching, and both Full Refresh and Incremental syncs, using the last_modified property of files to determine
          incremental batches. You can choose if this connector will read only the new/updated files, or all the
          matching files, every time a sync is run.
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/s3#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.aws_cloudtrail,
    docker_image_name: "airbyte/source-aws-cloudtrail",
    displayName: "AWS CloudTrail",
    stable: false,
    documentation: {
      overview: (
        <>
          This source can sync data from the{" "}
          <a target="_blank" href="https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/Welcome.html">
            AWS CloudTrail API
          </a>
          . Currently only{" "}
          <a
            target="_blank"
            href="https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/cloudtrail.html#CloudTrail.Client.lookup_events"
          >
            Management events
          </a>{" "}
          sync is supported.
        </>
      ),
      connection: (
        <>
          Please, follow this{" "}
          <a
            target="_blank"
            href="https://docs.aws.amazon.com/powershell/latest/userguide/pstools-appendix-sign-up.html"
          >
            steps
          </a>{" "}
          to get your AWS access key and secret.
        </>
      ),
    },
  },
  {
    pic: logos.tap_intercom,
    docker_image_name: "airbyte/source-intercom",
    displayName: "Intercom",
    stable: false,
    documentation: intercomDocumentation,
  },
  {
    pic: logos.tap_harvest,
    docker_image_name: "airbyte/source-harvest",
    displayName: "Harvest",
    stable: false,
    documentation: {
      overview: (
        <>
          The Harvest connector can be used to sync your Harvest data{": "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/clients-api/clients/contacts/">
            Client Contacts
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/clients-api/clients/clients/">
            Clients
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/company-api/company/company/">
            Company
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/invoices-api/invoices/invoice-messages/">
            Invoice Messages
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/invoices-api/invoices/invoice-payments/">
            Invoice Payments
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/invoices-api/invoices/invoices/">
            Invoices
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/invoices-api/invoices/invoice-item-categories/">
            Invoice Item Categories
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/estimates-api/estimates/estimate-messages/">
            Estimate Messages
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/estimates-api/estimates/estimates/">
            Estimates
          </a>
          {", "}
          <a
            target="_blank"
            href="https://help.getharvest.com/api-v2/estimates-api/estimates/estimate-item-categories/"
          >
            Estimate Item Categories
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/expenses-api/expenses/expenses/">
            Expenses
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/expenses-api/expenses/expense-categories/">
            Expense Categories
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/tasks-api/tasks/tasks/">
            Tasks
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/timesheets-api/timesheets/time-entries/">
            Time Entries
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/projects-api/projects/user-assignments/">
            Project User Assignments
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/projects-api/projects/task-assignments/">
            Project Task Assignments
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/projects-api/projects/projects/">
            Projects
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/roles-api/roles/roles/">
            Roles
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/users-api/users/billable-rates/">
            User Billable Rates
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/users-api/users/cost-rates/">
            User Cost Rates
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/users-api/users/project-assignments/">
            User Project Assignments
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/reports-api/reports/expense-reports/">
            Expense Reports
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/reports-api/reports/uninvoiced-report/">
            Uninvoiced Report
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/reports-api/reports/time-reports/">
            Time Reports
          </a>
          {", "}
          <a target="_blank" href="https://help.getharvest.com/api-v2/reports-api/reports/project-budget-report/">
            Project Budget Report
          </a>
        </>
      ),
      connection: (
        <>
          This connector supports only authentication with API Key. To obtain API key: Go to Account Settings page and
          Under Integrations section press Authorized OAuth2 API Clients button. New page will be opened on which you
          need to click on Create New Personal Access Token button and follow instructions. See{" "}
          <a
            target="_blank"
            href="https://help.getharvest.com/api-v2/authentication-api/authentication/authentication/"
          >
            docs
          </a>{" "}
          for more details.
        </>
      ),
    },
  },
  {
    pic: logos.tempo,
    docker_image_name: "airbyte/source-tempo",
    displayName: "Tempo",
    stable: false,
    documentation: {
      overview: (
        <>
          This Source syncs data from{" "}
          <a target="_blank" href="https://tempo-io.github.io/tempo-api-docs">
            Tempo REST API version 3
          </a>
          : Accounts, Customers, Worklogs, Workload and Schemes.
        </>
      ),
      connection: (
        <>
          Source Tempo is designed to interact with the data your permissions give you access to. To do so, you will
          need to generate a Tempo OAuth 2.0 token for an individual user. Go to <b>Tempo {"->"} Settings</b>, scroll
          down to <b>Data Access</b> and select <b>API integration</b>.
        </>
      ),
    },
  },
  {
    pic: logos.snowflake,
    docker_image_name: "airbyte/source-snowflake",
    displayName: "Snowflake",
    stable: false,
    documentation: {
      overview: <>Snowflake connector pulls data from the remote database.</>,
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/snowflake#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.zendesk,
    docker_image_name: "airbyte/source-zendesk-talk",
    displayName: "Zendesk Talk",
    stable: false,
    documentation: {
      overview: (
        <>
          This source can sync data for the{" "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/voice-api/introduction">
            Zendesk Talk API
          </a>
          {": "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/voice-api/stats#show-account-overview">
            Account{" "}
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.zendesk.com/rest_api/docs/voice-api/phone_numbers#list-phone-numbers"
          >
            Addresses
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/voice-api/stats#list-agents-activity">
            Agents Activity
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/voice-api/stats#show-agents-overview">
            Agents{" "}
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.zendesk.com/rest_api/docs/voice-api/incremental_exports#incremental-calls-export"
          >
            Calls
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.zendesk.com/rest_api/docs/voice-api/incremental_exports#incremental-call-legs-export"
          >
            Call Legs
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.zendesk.com/rest_api/docs/voice-api/stats#show-current-queue-activity"
          >
            Current Queue Activity
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.zendesk.com/rest_api/docs/voice-api/greetings#list-greeting-categories"
          >
            Greeting Categories
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/voice-api/greetings#list-greetings">
            Greetings
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/voice-api/ivrs#list-ivrs">
            IVRs
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/voice-api/ivrs#list-ivrs">
            IVR Menus
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/voice-api/ivr_routes#list-ivr-routes">
            IVR Routes
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.zendesk.com/rest_api/docs/voice-api/phone_numbers#list-phone-numbers"
          >
            Phone Numbers
          </a>
        </>
      ),
      connection: (
        <>
          Generate a API access token as described in{" "}
          <a target="_blank" href="https://support.zendesk.com/hc/en-us/articles/226022787-Generating-a-new-API-token-">
            Zendesk docs
          </a>
          . We recommend creating a restricted, read-only key specifically for access. This will allow you to control
          which resources should be able to access.
        </>
      ),
    },
  },
  {
    pic: logos.iterable,
    docker_image_name: "airbyte/source-iterable",
    displayName: "Iterable",
    stable: false,
    documentation: {
      overview: (
        <>
          The Iterable can sync data from the{" "}
          <a target="_blank" href="https://api.iterable.com/api/docs">
            Iterable API
          </a>
          {": "}
          <a target="_blank" href="https://api.iterable.com/api/docs#campaigns_campaigns">
            Campaigns
          </a>
          {", "}
          <a target="_blank" href="https://api.iterable.com/api/docs#channels_channels">
            Channels
          </a>
          {", "}
          <a target="_blank" href="https://api.iterable.com/api/docs#export_exportDataJson">
            Email Bounce
          </a>
          {", "}
          <a target="_blank" href="https://api.iterable.com/api/docs#export_exportDataJson">
            Email Click
          </a>
          {", "}
          <a target="_blank" href="https://api.iterable.com/api/docs#export_exportDataJson">
            Email Complaint
          </a>
          {", "}
          <a target="_blank" href="https://api.iterable.com/api/docs#export_exportDataJson">
            Email Open
          </a>
          {", "}
          <a target="_blank" href="https://api.iterable.com/api/docs#export_exportDataJson">
            Email Send
          </a>
          {", "}
          <a target="_blank" href="https://api.iterable.com/api/docs#export_exportDataJson">
            Email Send Skip
          </a>
          {", "}
          <a target="_blank" href="https://api.iterable.com/api/docs#export_exportDataJson">
            Email Subscribe
          </a>
          {", "}
          <a target="_blank" href="https://api.iterable.com/api/docs#export_exportDataJson">
            Email Unsubscribe
          </a>
          {", "}
          <a target="_blank" href="https://api.iterable.com/api/docs#lists_getLists">
            Lists
          </a>
          {", "}
          <a target="_blank" href="https://api.iterable.com/api/docs#lists_getLists_0">
            List Users
          </a>
          {", "}
          <a target="_blank" href="https://api.iterable.com/api/docs#messageTypes_messageTypes">
            Message Types
          </a>
          {", "}
          <a target="_blank" href="https://api.iterable.com/api/docs#metadata_list_tables">
            Metadata
          </a>
          {", "}
          <a target="_blank" href="https://api.iterable.com/api/docs#templates_getTemplates">
            Templates
          </a>
          {", "}
          <a target="_blank" href="https://api.iterable.com/api/docs#export_exportDataJson">
            Users
          </a>
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a
            target="_blank"
            href="https://support.iterable.com/hc/en-us/articles/360043464871-API-Keys-#creating-api-keys"
          >
            How to find your API key
          </a>
          .
        </>
      ),
    },
  },
  {
    pic: logos.paypal,
    docker_image_name: "airbyte/source-paypal-transaction",
    displayName: "Paypal Transaction",
    stable: false,
    documentation: {
      overview: (
        <>
          The Paypal source syncs data from The{" "}
          <a target="_blank" href="https://developer.paypal.com/docs/api/transaction-search/v1/">
            Paypal Transaction API
          </a>
          {": "}
          <a target="_blank" href="https://developer.paypal.com/docs/api/transaction-search/v1/#transactions">
            Transactions
          </a>
          {", "}
          <a target="_blank" href="https://developer.paypal.com/docs/api/transaction-search/v1/#balances">
            Balances
          </a>
        </>
      ),
      connection: (
        <>
          In order to get an Client ID and Secret please go to{" "}
          <a target="_blank" href="https://developer.paypal.com/docs/platforms/get-started/">
            PayPal page
          </a>{" "}
          and follow the instructions. After registration you may find your Client ID and Secret{" "}
          <a target="_blank" href="https://developer.paypal.com/developer/accounts/">
            here
          </a>
          .
        </>
      ),
    },
  },
  {
    pic: logos.cartcom,
    docker_image_name: "airbyte/source-cart",
    displayName: "Cart.com",
    stable: false,
    documentation: {
      overview: (
        <>
          This source can sync data from the{" "}
          <a target="_blank" href="https://developers.cart.com/docs/rest-api/docs/README.md">
            Cart API
          </a>
          {": "}
          <a target="_blank" href="https://developers.cart.com/docs/rest-api/restapi.json/paths/~1customers/get">
            CustomersCart
          </a>
          {", "}
          <a target="_blank" href="https://developers.cart.com/docs/rest-api/restapi.json/paths/~1orders/get">
            Orders
          </a>
          {", "}
          <a target="_blank" href="https://developers.cart.com/docs/rest-api/restapi.json/paths/~1order_payments/get">
            OrderPayments
          </a>
          {", "}
          <a target="_blank" href="https://developers.cart.com/docs/rest-api/restapi.json/paths/~1products/get">
            Products
          </a>
        </>
      ),
      connection: (
        <>
          Please follow these{" "}
          <a target="_blank" href="https://developers.cart.com/docs/rest-api/docs/README.md#setup">
            steps
          </a>{" "}
          to obtain Access Token for your account.
        </>
      ),
    },
  },
  {
    pic: logos.cockroachdb,
    docker_image_name: "airbyte/source-cockroachdb",
    displayName: "CockroachDB",
    stable: false,
    documentation: {
      overview: <>The CockroachDB MySQL connector pulls data from the remote database.</>,
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/cockroachdb#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.tap_klaviyo,
    docker_image_name: "airbyte/source-klaviyo",
    displayName: "Klaviyo",
    stable: false,
    documentation: {
      overview: (
        <>
          This source can sync data from the{" "}
          <a target="_blank" href="https://apidocs.klaviyo.com/reference/api-overview">
            Klaviyo API
          </a>
          {": "}
          <a target="_blank" href="https://apidocs.klaviyo.com/reference/campaigns#get-campaigns">
            Campaigns
          </a>
          {", "}
          <a target="_blank" href="https://apidocs.klaviyo.com/reference/metrics#metrics-timeline">
            Events
          </a>
          {", "}
          <a target="_blank" href="https://apidocs.klaviyo.com/reference/lists-segments#get-global-exclusions">
            GlobalExclusions
          </a>
          {", "}
          <a target="_blank" href="https://apidocs.klaviyo.com/reference/lists#get-lists-deprecated">
            Lists
          </a>
        </>
      ),
      connection: (
        <>
          Please follow these{" "}
          <a
            target="_blank"
            href="https://help.klaviyo.com/hc/en-us/articles/115005062267-How-to-Manage-Your-Account-s-API-Keys#your-private-api-keys3"
          >
            steps
          </a>
          to obtain Private API Key for your account.
        </>
      ),
    },
  },
  {
    pic: logos.tap_ibm_db2,
    docker_image_name: "airbyte/source-db2",
    displayName: "IMB Db2",
    stable: false,
    documentation: {
      overview: <>The IBM Db2 connector pulls data from the remote database.</>,
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/db2#setup-guide">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.okta,
    docker_image_name: "airbyte/source-okta",
    displayName: "Okta",
    stable: false,
    documentation: {
      overview: (
        <>
          This source can sync data from the{" "}
          <a target="_blank" href="https://developer.okta.com/docs/reference/">
            Okta API
          </a>
          {": "}
          <a target="_blank" href="https://developer.okta.com/docs/reference/api/users/#list-users">
            Users
          </a>
          {", "}
          <a target="_blank" href="https://developer.okta.com/docs/reference/api/groups/#list-groups">
            Groups
          </a>
          {", "}
          <a target="_blank" href="https://developer.okta.com/docs/reference/api/system-log/#get-started">
            System Log
          </a>
        </>
      ),
      connection: (
        <>
          In order to pull data out of your Okta instance, you need to create an{" "}
          <a target="_blank" href="https://developer.okta.com/docs/guides/create-an-api-token/overview/">
            API Token
          </a>
          . Different Okta APIs require different admin privilege levels. API tokens inherit the privilege level of the
          admin account used to create them. Sign in to your Okta organization as a user with{" "}
          <a target="_blank" href="https://help.okta.com/en/prod/okta_help_CSH.htm#ext_Security_Administrators">
            administrator privileges
          </a>{" "}
          Access the API page: In the Admin Console, select API from the Security menu and then select the Tokens tab.
          Click Create Token. Name your token and click Create Token. Record the token value. This is the only
          opportunity to see it and record it.
        </>
      ),
    },
  },
  {
    pic: logos.bigquery,
    docker_image_name: "airbyte/source-bigquery",
    displayName: "BigQuery",
    stable: false,
    documentation: {
      overview: <>This source can sync data from BigQuery.</>,
      connection: (
        <>
          Read our documentation{" "}
          <a
            target="_blank"
            href="https://jitsu.com/docs/configuration/google-authorization#service-account-configuration"
          >
            page
          </a>{" "}
          about obtaining Google Authorization
        </>
      ),
    },
  },
  {
    pic: logos.dixa,
    docker_image_name: "airbyte/source-dixa",
    displayName: "Dixa",
    stable: false,
    documentation: {
      overview: (
        <>
          This source can sync data from the{" "}
          <a target="_blank" href="https://support.dixa.help/en/articles/174-export-conversations-via-api">
            Dixa conversation_export API
          </a>
          {": "}
          <a target="_blank" href="https://support.dixa.help/en/articles/174-export-conversations-via-api">
            Conversation export
          </a>
        </>
      ),
      connection: (
        <>
          Generate an API token using the{" "}
          <a target="_blank" href="https://support.dixa.help/en/articles/259-how-to-generate-an-api-token">
            Dixa documentation
          </a>
          . Define a start_timestamp: the connector will pull records with updated_at {">="} start_timestamp. Define a
          batch_size: this represents the number of days which will be batched in a single request.
        </>
      ),
    },
  },
  {
    pic: logos.tap_recharge,
    docker_image_name: "airbyte/source-recharge",
    displayName: "Recharge",
    stable: false,
    documentation: {
      overview: (
        <>
          The Recharge source can sync data from the{" "}
          <a target="_blank" href="https://developer.rechargepayments.com/">
            Recharge API
          </a>
          {": "}
          <a target="_blank" href="https://developer.rechargepayments.com/v1-shopify">
            Collections
          </a>
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://support.rechargepayments.com/hc/en-us/articles/360008829993-ReCharge-API-">
            How to generate your API token
          </a>
          .
        </>
      ),
    },
  },
  {
    pic: logos.tap_chargebee,
    docker_image_name: "airbyte/source-chargebee",
    displayName: "Chargebee",
    stable: false,
    documentation: {
      overview: (
        <>
          The Chargebee source syncs data with{" "}
          <a target="_blank" href="https://github.com/chargebee/chargebee-python/">
            Chargebee Python Client Library
          </a>
          {": "}
          <a
            target="_blank"
            href="https://apidocs.chargebee.com/docs/api/subscriptions?prod_cat_ver=2#list_subscriptions"
          >
            Subscriptions
          </a>
          {", "}
          <a target="_blank" href="https://apidocs.chargebee.com/docs/api/customers?prod_cat_ver=2#list_customers">
            Customers
          </a>
          {", "}
          <a target="_blank" href="https://apidocs.chargebee.com/docs/api/invoices?prod_cat_ver=2#list_invoices">
            Invoices
          </a>
          {", "}
          <a target="_blank" href="https://apidocs.chargebee.com/docs/api/orders?prod_cat_ver=2#list_orders">
            Orders
          </a>
          {", "}
          <a target="_blank" href="https://apidocs.chargebee.com/docs/api/items?prod_cat_ver=2#list_items">
            Items
          </a>
          {", "}
          <a target="_blank" href="https://apidocs.chargebee.com/docs/api/item_prices?prod_cat_ver=2#list_item_prices">
            Item Prices
          </a>
          {", "}
          <a
            target="_blank"
            href="https://apidocs.chargebee.com/docs/api/attached_items?prod_cat_ver=2#list_attached_items"
          >
            Attached Items
          </a>
        </>
      ),
      connection: (
        <>
          Log into Chargebee and then generate an{" "}
          <a target="_blank" href="https://apidocs.chargebee.com/docs/api?prod_cat_ver=2#api_authentication">
            API Key
          </a>
          .Then follow{" "}
          <a target="_blank" href="https://apidocs.chargebee.com/docs/api?prod_cat_ver=2">
            these
          </a>{" "}
          instructions, under API Version section, on how to find your Product Catalog version.
        </>
      ),
    },
  },
  {
    pic: logos.tap_pipedrive,
    docker_image_name: "airbyte/source-pipedrive",
    displayName: "Pipedrive",
    stable: false,
    documentation: {
      overview: (
        <>
          The Pipedrive connector syncs data from{" "}
          <a target="_blank" href="https://developers.pipedrive.com/docs/api/v1">
            PipeDrive API
          </a>
          . {": "}
          <a target="_blank" href="https://developers.pipedrive.com/docs/api/v1/Activities#getActivities">
            Activities
          </a>
          {", "}
          <a target="_blank" href="https://developers.pipedrive.com/docs/api/v1/Recents#getRecents">
            getRecents
          </a>
          {", "}
          <a target="_blank" href="https://developers.pipedrive.com/docs/api/v1/ActivityFields#getActivityFields">
            ActivityFields
          </a>
          {", "}
          <a target="_blank" href="https://developers.pipedrive.com/docs/api/v1/Deals#getDeals">
            Deals
          </a>
          {", "}
          <a target="_blank" href="https://developers.pipedrive.com/docs/api/v1/Recents#getRecents">
            getRecents
          </a>
          {", "}
          <a target="_blank" href="https://developers.pipedrive.com/docs/api/v1/Leads#getLeads">
            Leads
          </a>
          {", "}
          <a target="_blank" href="https://developers.pipedrive.com/docs/api/v1/Persons#getPersons">
            Persons
          </a>
          {", "}
          <a target="_blank" href="https://developers.pipedrive.com/docs/api/v1/Recents#getRecents">
            getRecents
          </a>
          {", "}
          <a target="_blank" href="https://developers.pipedrive.com/docs/api/v1/Pipelines#getPipelines">
            Pipelines
          </a>
          {", "}
          <a target="_blank" href="https://developers.pipedrive.com/docs/api/v1/Recents#getRecents">
            getRecents
          </a>
          {", "}
          <a target="_blank" href="https://developers.pipedrive.com/docs/api/v1/Stages#getStages">
            Stages
          </a>
          {", "}
          <a target="_blank" href="https://developers.pipedrive.com/docs/api/v1/Recents#getRecents">
            getRecents
          </a>
          {", "}
          <a target="_blank" href="https://developers.pipedrive.com/docs/api/v1/Users#getUsers">
            Users
          </a>
          {", "}
          <a target="_blank" href="https://developers.pipedrive.com/docs/api/v1/Recents#getRecents">
            getRecents
          </a>
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/pipedrive#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.tap_square,
    docker_image_name: "airbyte/source-square",
    displayName: "Square",
    stable: false,
    documentation: {
      overview: (
        <>
          The Square Source can sync data from the{" "}
          <a target="_blank" href="https://developer.squareup.com/reference/square">
            Square API
          </a>
          {": "}
          <a target="_blank" href="https://developer.squareup.com/explorer/square/catalog-api/search-catalog-objects">
            Items
          </a>
          {", "}
          <a target="_blank" href="https://developer.squareup.com/explorer/square/catalog-api/search-catalog-objects">
            Categories
          </a>
          {", "}
          <a target="_blank" href="https://developer.squareup.com/explorer/square/catalog-api/search-catalog-objects">
            Discounts
          </a>
          {", "}
          <a target="_blank" href="https://developer.squareup.com/explorer/square/catalog-api/search-catalog-objects">
            Taxes
          </a>
          {", "}
          <a target="_blank" href="https://developer.squareup.com/explorer/square/catalog-api/search-catalog-objects">
            ModifierLists
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.squareup.com/reference/square_2021-06-16/payments-api/list-payments"
          >
            Payments
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.squareup.com/reference/square_2021-06-16/refunds-api/list-payment-refunds"
          >
            Refunds
          </a>
          {", "}
          <a target="_blank" href="https://developer.squareup.com/explorer/square/locations-api/list-locations">
            Locations
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.squareup.com/reference/square_2021-06-16/team-api/search-team-members"
          >
            Team Members
          </a>
          {", "}
          <a target="_blank" href="https://developer.squareup.com/explorer/square/labor-api/list-team-member-wages">
            List Team Member Wages
          </a>
          {", "}
          <a target="_blank" href="https://developer.squareup.com/explorer/square/customers-api/list-customers">
            Customers
          </a>
          {", "}
          <a target="_blank" href="https://developer.squareup.com/reference/square/labor-api/search-shifts">
            Shifts
          </a>
          {", "}
          <a target="_blank" href="https://developer.squareup.com/reference/square/orders-api/search-orders">
            Orders
          </a>
        </>
      ),
      connection: (
        <>
          To get the API key for your square application follow{" "}
          <a target="_blank" href="https://developer.squareup.com/docs/get-started">
            Geting started
          </a>{" "}
          and{" "}
          <a target="_blank" href="https://developer.squareup.com/docs/build-basics/access-tokens">
            Access token
          </a>{" "}
          guides
        </>
      ),
    },
  },
  {
    pic: logos.tap_gitlab,
    docker_image_name: "airbyte/source-gitlab",
    displayName: "GitLab",
    stable: false,
    documentation: {
      overview: (
        <>
          The Gitlab source syncs data from the{" "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/">
            Gitlab API
          </a>
          {": "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/branches.html">
            Branches
          </a>
          {", "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/commits.html">
            Commits
          </a>
          {", "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/issues.html">
            Issues
          </a>
          {", "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/pipelines.html">
            Pipelines
          </a>
          {", "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/jobs.html">
            Jobs
          </a>
          {", "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/projects.html">
            Projects
          </a>
          {", "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/milestones.html">
            Project Milestones
          </a>
          {", "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/merge_requests.html">
            Project Merge Requests
          </a>
          {", "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/users.html">
            Users
          </a>
          {", "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/groups.html">
            Groups
          </a>
          {", "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/group_milestones.html">
            Group Milestones
          </a>
          {", "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/members.html">
            Group and Project members
          </a>
          {", "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/tags.html">
            Tags
          </a>
          {", "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/releases/index.html">
            Releases
          </a>
          {", "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/group_labels.html">
            Group Labels
          </a>
          {", "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/labels.html">
            Project Labels
          </a>
          {", "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/epics.html">
            Epics
          </a>
          {", "}
          <a target="_blank" href="https://docs.gitlab.com/ee/api/epic_issues.html">
            Epic Issues
          </a>
        </>
      ),
      connection: (
        <>
          Log into Gitlab and then generate a{" "}
          <a target="_blank" href="https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html">
            personal access token
          </a>
          . Your token should have the read_api scope, that Grants read access to the API, including all groups and
          projects, the container registry, and the package registry.
        </>
      ),
    },
  },
  {
    pic: logos.snapchat_marketing,
    docker_image_name: "airbyte/source-snapchat-marketing",
    displayName: "Snapchat Marketing",
    stable: false,
    documentation: {
      overview: (
        <>
          The Snapchat Marketing source can sync data from the{" "}
          <a target="_blank" href="https://marketingapi.snapchat.com/docs/">
            Snapchat Marketing API
          </a>
          {": "}
          <a target="_blank" href="https://marketingapi.snapchat.com/docs/#organizations">
            Organization
          </a>
          {", "}
          <a target="_blank" href="https://marketingapi.snapchat.com/docs/#get-all-ad-accounts">
            Ad Account
          </a>
          {", "}
          <a target="_blank" href="https://marketingapi.snapchat.com/docs/#get-all-creatives">
            Creative
          </a>
          {", "}
          <a target="_blank" href="https://marketingapi.snapchat.com/docs/#get-all-media">
            Media
          </a>
          {", "}
          <a target="_blank" href="https://marketingapi.snapchat.com/docs/#get-all-campaigns">
            Campaign
          </a>
          {", "}
          <a target="_blank" href="https://marketingapi.snapchat.com/docs/#get-all-ads-under-an-ad-account">
            Ad
          </a>
          {", "}
          <a target="_blank" href="https://marketingapi.snapchat.com/docs/#get-all-ad-squads-under-an-ad-account">
            Ad Squad
          </a>
          {", "}
          <a target="_blank" href="https://marketingapi.snapchat.com/docs/#get-all-audience-segments">
            Segments
          </a>
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/snapchat-marketing#setup-guide">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.tap_mixpanel,
    docker_image_name: "airbyte/source-mixpanel",
    displayName: "Mixpanel",
    stable: false,
    documentation: mixpanelDocumentation,
  },
  {
    pic: logos.twilio,
    docker_image_name: "airbyte/source-twilio",
    displayName: "Twilio",
    stable: false,
    documentation: {
      overview: (
        <>
          The Twilio connector can sync data from the{" "}
          <a target="_blank" href="https://www.twilio.com/docs/usage/api">
            Twilio API
          </a>
          {": "}
          <a target="_blank" href="https://www.twilio.com/docs/usage/api/account#read-multiple-account-resources">
            Accounts
          </a>
          {", "}
          <a target="_blank" href="https://www.twilio.com/docs/usage/api/address#read-multiple-address-resources">
            Addresses
          </a>
          {", "}
          <a target="_blank" href="https://www.twilio.com/docs/usage/monitor-alert#read-multiple-alert-resources">
            Alerts
          </a>
          {", "}
          <a
            target="_blank"
            href="https://www.twilio.com/docs/usage/api/applications#read-multiple-application-resources"
          >
            Applications
          </a>
          {", "}
          <a
            target="_blank"
            href="https://www.twilio.com/docs/phone-numbers/api/availablephonenumber-resource#read-a-list-of-countries"
          >
            Available Phone Number Countries
          </a>
          {", "}
          <a
            target="_blank"
            href="https://www.twilio.com/docs/phone-numbers/api/availablephonenumberlocal-resource#read-multiple-availablephonenumberlocal-resources"
          >
            Available Phone Numbers Local
          </a>
          {", "}
          <a
            target="_blank"
            href="https://www.twilio.com/docs/phone-numbers/api/availablephonenumber-mobile-resource#read-multiple-availablephonenumbermobile-resources"
          >
            Available Phone Numbers Mobile
          </a>
          {", "}
          <a
            target="_blank"
            href="https://www.twilio.com/docs/phone-numbers/api/availablephonenumber-tollfree-resource#read-multiple-availablephonenumbertollfree-resources"
          >
            Available Phone Numbers Toll Free
          </a>
          {", "}
          <a target="_blank" href="https://www.twilio.com/docs/voice/api/call-resource#create-a-call-resource">
            Calls
          </a>
          {", "}
          <a
            target="_blank"
            href="https://www.twilio.com/docs/voice/api/conference-participant-resource#read-multiple-participant-resources"
          >
            Conference Participants
          </a>
          {", "}
          <a
            target="_blank"
            href="https://www.twilio.com/docs/voice/api/conference-resource#read-multiple-conference-resources"
          >
            Conferences
          </a>
          {", "}
          <a
            target="_blank"
            href="https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource#read-multiple-incomingphonenumber-resources"
          >
            Incoming Phone Numbers
          </a>
          {", "}
          <a target="_blank" href="https://www.twilio.com/docs/usage/api/keys#read-a-key-resource">
            Keys
          </a>
          {", "}
          <a target="_blank" href="https://www.twilio.com/docs/sms/api/media-resource#read-multiple-media-resources">
            Message Media
          </a>
          {", "}
          <a
            target="_blank"
            href="https://www.twilio.com/docs/sms/api/message-resource#read-multiple-message-resources"
          >
            Messages
          </a>
          {", "}
          <a
            target="_blank"
            href="https://www.twilio.com/docs/voice/api/outgoing-caller-ids#outgoingcallerids-list-resource"
          >
            Outgoing Caller Ids
          </a>
          {", "}
          <a target="_blank" href="https://www.twilio.com/docs/voice/api/queue-resource#read-multiple-queue-resources">
            Queues
          </a>
          {", "}
          <a target="_blank" href="https://www.twilio.com/docs/voice/api/recording#read-multiple-recording-resources">
            Recordings
          </a>
          {", "}
          <a
            target="_blank"
            href="https://www.twilio.com/docs/usage/api/usage-record#read-multiple-usagerecord-resources"
          >
            Usage Records
          </a>
          {", "}
          <a
            target="_blank"
            href="https://www.twilio.com/docs/usage/api/usage-trigger#read-multiple-usagetrigger-resources"
          >
            Usage Triggers
          </a>
        </>
      ),
      connection: (
        <>
          Twilio HTTP requests to the REST API are protected with HTTP Basic authentication. In short, you will use your
          Twilio Account SID as the username and your Auth Token as the password for HTTP Basic authentication.You can
          find your Account SID and Auth Token on your{" "}
          <a target="_blank" href="https://www.twilio.com/user/account">
            dashboard
          </a>{" "}
          .See{" "}
          <a target="_blank" href="https://www.twilio.com/docs/iam/api">
            docs
          </a>{" "}
          for more details.
        </>
      ),
    },
  },
  {
    pic: logos.tap_zendesk_support,
    docker_image_name: "airbyte/source-zendesk-support",
    displayName: "Zendesk Support",
    stable: false,
    documentation: {
      overview: (
        <>
          The Zendesk Support source syncs data from the{" "}
          <a target="_blank" href="https://developer.zendesk.com/api-reference/apps/apps-support-api/introduction/">
            Zendesk Support API
          </a>
          {": "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/support/tickets">
            Tickets
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/support/groups">
            Groups
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/support/users">
            Users
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/support/organizations">
            Organizations
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/support/ticket_audits">
            Ticket Audits
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/support/ticket_comments">
            Ticket Comments
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/support/ticket_fields">
            Ticket Fields
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/support/ticket_forms">
            Ticket Forms
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/support/ticket_metrics">
            Ticket Metrics
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/support/group_memberships">
            Group Memberships
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/support/macros">
            Macros
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/support/satisfaction_ratings">
            Satisfaction Ratings
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/support/tags">
            Tags
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/rest_api/docs/support/sla_policies">
            SLA Policies
          </a>
        </>
      ),
      connection: (
        <>
          Generate a API access token using the{" "}
          <a target="_blank" href="https://support.zendesk.com/hc/en-us/articles/226022787-Generating-a-new-API-token">
            Zendesk support
          </a>
          . We recommend creating a restricted, read-only key specifically for access. This will allow you to control
          which resources should be able to access.
        </>
      ),
    },
  },
  {
    pic: logos.us_census,
    docker_image_name: "airbyte/source-us-census",
    displayName: "US Census",
    stable: false,
    documentation: {
      overview: (
        <>
          This connector syncs data from the{" "}
          <a
            target="_blank"
            href="https://www.census.gov/data/developers/guidance/api-user-guide.Example_API_Queries.html"
          >
            US Census API
          </a>
          .
        </>
      ),
      connection: (
        <>
          Visit the{" "}
          <a target="_blank" href="https://api.census.gov/data/key_signup.html">
            US Census API page
          </a>{" "}
          to obtain an API key.In addition, to understand how to configure the dataset path and query parameters, follow
          the guide and examples in the{" "}
          <a target="_blank" href="https://www.census.gov/data/developers/data-sets.html">
            API documentation
          </a>
          . Some particularly helpful pages:
          <ul>
            <li>
              <a
                target="_blank"
                href="https://www.census.gov/data/developers/guidance/api-user-guide.Available_Data.html"
              >
                Available Datasets
              </a>
            </li>
            <li>
              <a
                target="_blank"
                href="https://www.census.gov/data/developers/guidance/api-user-guide.Core_Concepts.html"
              >
                Core Concepts
              </a>
            </li>
            <li>
              <a
                target="_blank"
                href="https://www.census.gov/data/developers/guidance/api-user-guide.Example_API_Queries.html"
              >
                Example Queries
              </a>
            </li>
          </ul>
        </>
      ),
    },
  },
  {
    pic: logos.tap_typeform,
    docker_image_name: "airbyte/source-typeform",
    displayName: "Typeform",
    stable: false,
    documentation: {
      overview: (
        <>
          The Typeform Connector syncs data from the{" "}
          <a target="_blank" href="https://developer.typeform.com/get-started/">
            Typeform
          </a>
          {": "}
          <a target="_blank" href="https://developer.typeform.com/create/reference/retrieve-form/">
            Forms
          </a>
          {", "}
          <a target="_blank" href="https://developer.typeform.com/responses/reference/retrieve-responses/">
            Responses
          </a>
        </>
      ),
      connection: (
        <>
          To get the API token for your application follow this{" "}
          <a target="_blank" href="https://developer.typeform.com/get-started/personal-access-token/">
            steps
          </a>
          .{" "}
          <ul>
            <li>Log in to your account at Typeform</li>
            <li>In the upper-right corner, in the drop-down menu next to your profile photo, click My Account</li>
            <li>In the left menu, click Personal tokens</li>
            <li>Click Generate a new token</li>
            <li>In the Token name field, type a name for the token to help you identify it</li>
            <li>
              Choose needed scopes (API actions this token can perform - or permissions it has). See here for more
              details on scopes
            </li>
            <li>Click Generate token</li>
          </ul>
        </>
      ),
    },
  },

  {
    pic: logos.tap_surveymonkey,
    docker_image_name: "airbyte/source-surveymonkey",
    displayName: "Survey Monkey",
    stable: false,
    documentation: {
      overview: (
        <>
          This source syncs data from the{" "}
          <a target="_blank" href="https://developer.surveymonkey.com/api/v3/">
            SurveyMonkey API
          </a>
          {": "}
          <a target="_blank" href="https://developer.surveymonkey.com/api/v3/#surveys">
            Surveys
          </a>
          {", "}
          <a target="_blank" href="https://developer.surveymonkey.com/api/v3/#surveys-id-pages">
            SurveyPages
          </a>
          {", "}
          <a target="_blank" href="https://developer.surveymonkey.com/api/v3/#surveys-id-pages-id-questions">
            SurveyQuestions
          </a>
          {", "}
          <a target="_blank" href="https://developer.surveymonkey.com/api/v3/#survey-responses">
            SurveyResponses
          </a>
        </>
      ),
      connection: (
        <>
          Please read this{" "}
          <a target="_blank" href="https://developer.surveymonkey.com/api/v3/#getting-started">
            docs
          </a>
          . Register your application{" "}
          <a target="_blank" href="https://developer.surveymonkey.com/apps/">
            here
          </a>
          . Then go to Settings and copy your access token.
        </>
      ),
    },
  },
  {
    pic: logos.zendesk,
    docker_image_name: "airbyte/source-zendesk-sunshine",
    displayName: "Zendesk Sunshine",
    stable: false,
    documentation: {
      overview: (
        <>
          The Zendesk Chat source syncs data from the{" "}
          <a
            target="_blank"
            href="https://developer.zendesk.com/documentation/custom-data/custom-objects/custom-objects-handbook/"
          >
            Zendesk Sunshine API
          </a>
          {": "}
          <a
            target="_blank"
            href="https://developer.zendesk.com/api-reference/custom-data/custom-objects-api/resource_types/"
          >
            ObjectTypes
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.zendesk.com/api-reference/custom-data/custom-objects-api/resources/"
          >
            ObjectRecords
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.zendesk.com/api-reference/custom-data/custom-objects-api/relationship_types/"
          >
            RelationshipTypes
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.zendesk.com/api-reference/custom-data/custom-objects-api/relationships/"
          >
            RelationshipRecords
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.zendesk.com/api-reference/custom-data/custom-objects-api/permissions/"
          >
            ObjectTypePolicies
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/api-reference/custom-data/custom-objects-api/jobs/">
            Jobs
          </a>
          {", "}
          <a target="_blank" href="https://developer.zendesk.com/api-reference/custom-data/custom-objects-api/limits/">
            Limits
          </a>
        </>
      ),
      connection: (
        <>
          Please follow this{" "}
          <a
            target="_blank"
            href="https://developer.zendesk.com/documentation/custom-data/custom-objects/getting-started-with-custom-objects/#enabling-custom-objects"
          >
            guide
          </a>{" "}
          and Generate a Access Token as described in{" "}
          <a
            target="_blank"
            href="https://developer.zendesk.com/api-reference/ticketing/introduction/#security-and-authentication"
          >
            here
          </a>
          . We recommend creating a restricted, read-only key specifically for access. This will allow you to control
          which resources should be able to access.
        </>
      ),
    },
  },
  {
    pic: logos.prestashop,
    docker_image_name: "airbyte/source-prestashop",
    displayName: "Prestashop",
    stable: false,
    documentation: {
      overview: (
        <>
          The PrestaShop source syncs data from the{" "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice">
            PrestaShop API
          </a>
          {": "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/addresses/">
            Addresses
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/carriers/">
            Carriers
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/cart_rules/">
            Cart Rules
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/carts/">
            Carts
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/categories/">
            Categories
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/combinations/">
            Combinations
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/configurations/">
            Configurations
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/contacts/">
            Contacts
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/content_management_system/">
            Content Management System
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/countries/">
            Countries
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/currencies/">
            Currencies
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/customer_messages/">
            Customer Messages
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/customer_threads/">
            Customer Threads
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/customers/">
            Customers
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/deliveries/">
            Deliveries
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/employees/">
            Employees
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/groups/">
            Groups
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/guests/">
            Guests
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/image_types/">
            Image Types
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/languages/">
            Languages
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/manufacturers/">
            Manufacturers
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/messages/">
            Messages
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/order_carriers/">
            Order Carriers
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/order_details/">
            Order Details
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/order_histories/">
            Order Histories
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/order_invoices/">
            Order Invoices
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/order_payments/">
            Order Payments
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/order_slip/">
            Order Slip
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/order_states/">
            Order States
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/orders/">
            Orders
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/price_ranges/">
            Price Ranges
          </a>
          {", "}
          <a
            target="_blank"
            href="https://devdocs.prestashop.com/1.7/webservice/resources/product_customization_fields/"
          >
            Product Customization Fields
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/product_feature_values/">
            Product Feature Values
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/product_features/">
            Product Features
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/product_option_values/">
            Product Option Values
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/product_suppliers/">
            Product Suppliers
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/products/">
            Products
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/shop_groups/">
            ShopGroups
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/shop_urls/">
            ShopUrls
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/shops/">
            Shops
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/specific_price_rules/">
            Specific Price Rules
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/specific_prices/">
            Specific Prices
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/states/">
            States
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/stock_availables/">
            Stock Availables
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/stock_movement_reasons/">
            Stock Movement Reasons
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/stock_movements/">
            Stock Movements
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/stores/">
            Stores
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/suppliers/">
            Suppliers
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/tags/">
            Tags
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/tax_rule_groups/">
            Tax Rule Groups
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/tax_rules/">
            Tax Rules
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/taxes/">
            Taxes
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/translated_configurations/">
            Translated Configurations
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/weight_ranges/">
            Weight Ranges
          </a>
          {", "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/resources/zones/">
            Zones
          </a>
        </>
      ),
      connection: (
        <>
          PrestaShop enables merchants to give third-party tools access to their shop’s database through a CRUD API,
          otherwise called a{" "}
          <a target="_blank" href="https://devdocs.prestashop.com/1.7/webservice/">
            web service
          </a>
          . By default, the webservice feature is disabled on PrestaShop and needs to be{" "}
          <a
            target="_blank"
            href="https://devdocs.prestashop.com/1.7/webservice/tutorials/creating-access/#enable-the-webservice"
          >
            switched on
          </a>{" "}
          before the first use.
        </>
      ),
    },
  },
  {
    pic: logos.tap_bing_ads,
    docker_image_name: "airbyte/source-bing-ads",
    displayName: "Bing Ads",
    stable: false,
    documentation: {
      overview: (
        <>
          This source can sync data from the{" "}
          <a target="_blank" href="https://docs.microsoft.com/en-us/advertising/guides/?view=bingads-13">
            Bing Ads
          </a>
          {": "}
          <a
            target="_blank"
            href="https://docs.microsoft.com/en-us/advertising/customer-management-service/searchaccounts?view=bingads-13"
          >
            Accounts
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.microsoft.com/en-us/advertising/campaign-management-service/getcampaignsbyaccountid?view=bingads-13"
          >
            Campaigns
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.microsoft.com/en-us/advertising/campaign-management-service/getadgroupsbycampaignid?view=bingads-13"
          >
            AdGroups
          </a>
          {", "}
          <a
            target="_blank"
            href="https://docs.microsoft.com/en-us/advertising/campaign-management-service/getadsbyadgroupid?view=bingads-13"
          >
            Ads
          </a>
        </>
      ),
      connection: (
        <>
          <ul>
            <li>
              <a
                target="_blank"
                href="https://docs.microsoft.com/en-us/advertising/guides/authentication-oauth-register?view=bingads-13"
              >
                Register Application
              </a>{" "}
              in Azure portal{" "}
            </li>
            <li>
              Perform these{" "}
              <a
                target="_blank"
                href="https://docs.microsoft.com/en-us/advertising/guides/authentication-oauth-consent?view=bingads-13l"
              >
                steps
              </a>{" "}
              to get auth code.
            </li>
            <li>
              <a
                target="_blank"
                href="https://docs.microsoft.com/en-us/advertising/guides/authentication-oauth-get-tokens?view=bingads-13"
              >
                Get refresh token
              </a>{" "}
              using auth code from previous step
            </li>
          </ul>
          Full authentication process described{" "}
          <a
            target="_blank"
            href="https://docs.microsoft.com/en-us/advertising/guides/get-started?view=bingads-13#access-token"
          >
            here
          </a>{" "}
          Be aware that refresh token will expire in 90 days. You need to repeat auth process to get the new one refresh
          token.
        </>
      ),
    },
  },
  {
    pic: logos.tap_braintree,
    docker_image_name: "airbyte/source-braintree",
    displayName: "Braintree",
    stable: false,
    documentation: {
      overview: (
        <>
          This source can sync data for the{" "}
          <a target="_blank" href="https://developers.braintreepayments.com/start/overview">
            Braintree API
          </a>
          {": "}
          <a target="_blank" href="https://developer.paypal.com/braintree/docs/reference/request/customer/search">
            Customers
          </a>
          {", "}
          <a target="_blank" href="https://developer.paypal.com/braintree/docs/reference/response/discount">
            Discounts
          </a>
          {", "}
          <a target="_blank" href="https://developer.paypal.com/braintree/docs/reference/request/dispute/search">
            Disputes
          </a>
          {", "}
          <a target="_blank" href="https://developers.braintreepayments.com/reference/response/transaction/python">
            Transactions
          </a>
          {", "}
          <a target="_blank" href="https://developer.paypal.com/braintree/docs/reference/response/merchant-account">
            Merchant Accounts
          </a>
          {", "}
          <a target="_blank" href="https://developer.paypal.com/braintree/docs/reference/response/plan">
            Plans
          </a>
          {", "}
          <a target="_blank" href="https://developer.paypal.com/braintree/docs/reference/response/subscription">
            Subscriptions
          </a>
        </>
      ),
      connection: (
        <>
          Generate all requirements using the{" "}
          <a target="_blank" href="https://articles.braintreepayments.com/control-panel/important-gateway-credentials">
            Braintree documentation
          </a>
          .
        </>
      ),
    },
  },
  {
    pic: logos.tap_zuora,
    docker_image_name: "airbyte/source-zuora",
    displayName: "Zuora",
    stable: false,
    documentation: {
      overview: (
        <>
          The Zuora source syncs data from the{" "}
          <a target="_blank" href="https://www.zuora.com/developer/api-reference/#section/Introduction">
            Zuora REST API
          </a>
          {": "} standard objects, custom objects manually added by user, custom fields in both standard and custom
          objects available in Zuora Account. The discovering of Zuora Account objects schema may take a while, if you
          add the connection for the first time, and/or you need to refresh your list of available streams. Please take
          your time to wait and don't cancel this operation, usually it takes up to 5-10 min, depending on number of
          objects available in Zuora Account.
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/zuora#getting-started">
            setup guide
          </a>{" "}
          for more information.
        </>
      ),
    },
  },
  {
    pic: logos.tap_kustomer,
    //Deprecated until https://github.com/singer-io/tap-kustomer/issues/21 resolved
    deprecated: true,
    docker_image_name: "airbyte/source-kustomer",
    displayName: "Kustomer",
    stable: false,
    documentation: {
      overview: (
        <>
          The Kustomer source syncs data from the{" "}
          <a target="_blank" href="https://developer.kustomer.com/kustomer-api-docs">
            Kustomer API
          </a>
          {": "}
          <a target="_blank" href="https://developer.kustomer.com/kustomer-api-docs/reference/conversations">
            Conversations
          </a>
          {", "}
          <a target="_blank" href="https://developer.kustomer.com/kustomer-api-docs/reference/customers">
            Customers
          </a>
          {", "}
          <a target="_blank" href="https://developer.kustomer.com/kustomer-api-docs/reference/kobjects-custom-objects">
            KObjects
          </a>
          {", "}
          <a target="_blank" href="https://developer.kustomer.com/kustomer-api-docs/reference/messages">
            Messages
          </a>
          {", "}
          <a target="_blank" href="https://developer.kustomer.com/kustomer-api-docs/reference/notes">
            Notes
          </a>
          {", "}
          <a target="_blank" href="https://developer.kustomer.com/kustomer-api-docs/reference/shortcuts">
            Shortcuts
          </a>
          {", "}
          <a target="_blank" href="https://developer.kustomer.com/kustomer-api-docs/reference/tags-knowledge-base">
            Tags
          </a>
          {", "}
          <a target="_blank" href="https://developer.kustomer.com/kustomer-api-docs/reference/teams">
            Teams
          </a>
          {", "}
          <a target="_blank" href="https://developer.kustomer.com/kustomer-api-docs/reference/users">
            Users
          </a>
        </>
      ),
      connection: (
        <>
          See the{" "}
          <a target="_blank" href="https://help.kustomer.com/api-keys-SJs5YTIWX">
            Kustomer docs
          </a>{" "}
          for information on how to obtain an API token
        </>
      ),
    },
  },
  {
    pic: logos.shortio,
    docker_image_name: "airbyte/source-shortio",
    displayName: "Short.io",
    stable: false,
    documentation: {
      overview: (
        <>
          The Short.io source syncs data from the{" "}
          <a target="_blank" href="https://developers.short.io/reference">
            Shortio API
          </a>
          {": "}
          <a target="_blank" href="https://developers.short.io/reference#getdomaindomainidlink_clicks">
            Clicks
          </a>
          {", "}
          <a target="_blank" href="https://developers.short.io/reference#apilinksget">
            Links
          </a>
        </>
      ),
      connection: (
        <>
          <ul>
            <li>Sign in at app.short.io</li>
            <li>Go to settings and click on Integrations & API</li>
            <li>In the API tab, click Create API Kay. Select Private Key</li>
            <li>Use the created secret key to configure your source</li>
          </ul>
        </>
      ),
    },
  },
  {
    pic: logos.tap_trello,
    docker_image_name: "airbyte/source-trello",
    displayName: "Trello",
    stable: false,
    documentation: {
      overview: (
        <>
          The Trello source syncs data from{" "}
          <a target="_blank" href="https://developer.atlassian.com/cloud/trello/rest/api-group-boards">
            Trello Boards API
          </a>
          {": "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/trello/rest/api-group-boards/#api-boards-id-memberships-get"
          >
            Boards
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/trello/rest/api-group-boards/#api-boards-boardid-actions-get"
          >
            Actions
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/trello/rest/api-group-boards/#api-boards-id-cards-get"
          >
            Cards
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/trello/rest/api-group-boards/#api-boards-id-checklists-get"
          >
            Checklists
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/trello/rest/api-group-boards/#api-boards-id-lists-get"
          >
            Lists
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/trello/rest/api-group-boards/#api-boards-id-members-get"
          >
            Users
          </a>
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a
            target="_blank"
            href="https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/#using-basic-oauth"
          >
            How to get your APIs Token and Key
          </a>{" "}
          or you can log in to Trello and visit{" "}
          <a target="_blank" href="https://trello.com/app-key/">
            Developer API Keys
          </a>
          .
        </>
      ),
    },
  },
  {
    hasNativeEquivalent: false,
    pic: logos.tap_google_sheets,
    docker_image_name: "airbyte/source-google-sheets",
    displayName: "Google Sheets",
    stable: false,
    documentation: googleSheetsDocumentation,
  },
  {
    pic: logos.amazon,
    docker_image_name: "airbyte/source-amazon-ads",
    displayName: "Amazon Ads",
    stable: false,
    documentation: {
      overview: (
        <>
          This source syncs data from{" "}
          <a target="_blank" href="https://advertising.amazon.com/API/docs/en-us/what-is/amazon-advertising-api">
            Amazon Advertising API
          </a>
          {": "}
          <a target="_blank" href="https://advertising.amazon.com/API/docs/en-us/reference/2/profiles#/Profiles">
            Profiles
          </a>
          {", "}
          <a
            target="_blank"
            href="https://advertising.amazon.com/API/docs/en-us/sponsored-brands/3-0/openapi#/Campaigns"
          >
            Sponsored Brands Campaigns
          </a>
          {", "}
          <a
            target="_blank"
            href="https://advertising.amazon.com/API/docs/en-us/sponsored-brands/3-0/openapi#/Keywords"
          >
            Sponsored Brands Keywords
          </a>
          {", "}
          <a
            target="_blank"
            href="https://advertising.amazon.com/API/docs/en-us/sponsored-display/3-0/openapi#/Campaigns"
          >
            Sponsored Display Campaigns
          </a>
          {", "}
          <a
            target="_blank"
            href="https://advertising.amazon.com/API/docs/en-us/sponsored-display/3-0/openapi#/Targeting"
          >
            Sponsored Display Targetings
          </a>
          {", "}
          <a
            target="_blank"
            href="https://advertising.amazon.com/API/docs/en-us/sponsored-display/3-0/openapi#/Campaigns"
          >
            Sponsored Products Campaigns
          </a>
          {", "}
          <a
            target="_blank"
            href="https://advertising.amazon.com/API/docs/en-us/sponsored-products/2-0/openapi#/Keywords"
          >
            Sponsored Products Keywords
          </a>
          {", "}
          <a target="_blank" href="https://advertising.amazon.com/API/docs/en-us/reference/sponsored-brands/2/reports">
            Brands Reports
          </a>
          {", "}
          <a
            target="_blank"
            href="https://advertising.amazon.com/API/docs/en-us/sponsored-display/3-0/openapi#/Reports"
          >
            Display Reports
          </a>
          {", "}
          <a
            target="_blank"
            href="https://advertising.amazon.com/API/docs/en-us/sponsored-products/2-0/openapi#/Reports"
          >
            Products Reports
          </a>
        </>
      ),
      connection: (
        <>
          Please read{" "}
          <a target="_blank" href="https://docs.airbyte.io/integrations/sources/amazon-ads#getting-started">
            setup guide
          </a>{" "}
          for more information
        </>
      ),
    },
  },
  {
    pic: logos.bamboohr,
    docker_image_name: "airbyte/source-bamboo-hr",
    displayName: "BambooHR",
    stable: false,
    documentation: {
      overview: (
        <>
          The BambooHr source syncs data from{" "}
          <a target="_blank" href="https://documentation.bamboohr.com/">
            BambooHR API
          </a>
          {": "}
          <a target="_blank" href="https://documentation.bamboohr.com/reference#get-employees-directory-1">
            Employees
          </a>
        </>
      ),
      connection: (
        <>
          Read more about{" "}
          <a target="_blank" href="https://documentation.bamboohr.com/docs">
            how to get BambooHR API Key
          </a>
        </>
      ),
    },
  },
  {
    pic: logos.bigcommerce,
    docker_image_name: "airbyte/source-bigcommerce",
    displayName: "BigCommerce",
    stable: false,
    documentation: {
      overview: (
        <>
          The BigCommerce source syncs data from the{" "}
          <a target="_blank" href="https://developer.bigcommerce.com/api-docs/getting-started/making-requests">
            BigCommerce API
          </a>
          {": "}
          <a
            target="_blank"
            href="https://developer.bigcommerce.com/api-reference/store-management/customers-v3/customers/customersget"
          >
            Customers
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.bigcommerce.com/api-reference/store-management/orders/orders/getallorders"
          >
            Orders
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.bigcommerce.com/api-reference/store-management/order-transactions/transactions/gettransactions"
          >
            Transactions
          </a>
          {", "}
          <a
            target="_blank"
            href="https://developer.bigcommerce.com/api-reference/store-management/pages/pages/content-pages-get"
          >
            Pages
          </a>
        </>
      ),
      connection: (
        <>
          <ul>
            <li>
              Navigate to your store’s control panel (Advanced Settings {">"} API Accounts {">"} Create API Account)
            </li>
            <li>Create an API account.</li>
            <li>
              Select the resources you want to allow access to. Connector only needs read-level access. (Note: The UI
              will show all possible data sources and will show errors when syncing if it doesn't have permissions to
              access a resource)
            </li>
            <li>The generated Access Token is what you'll use as the access_token for the integration</li>
          </ul>
        </>
      ),
    },
  },
  {
    pic: logos.elasticsearch,
    docker_image_name: "airbyte/source-elasticsearch",
    displayName: "Elasticsearch",
    stable: false,
    documentation: {
      overview: (
        <>
          This source syncs data from an ElasticSearch domain.
          <br />
          This source automatically discovers all indices in the domain and can sync any of them.
          <br />
          ElasticSearch calls may be rate limited by the underlying service. This is specific to each deployment.
        </>
      ),
      connection: <></>,
    },
  },
]
