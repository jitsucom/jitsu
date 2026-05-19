import { coreDestinationsMap } from "./destinations";
import { safeParseWithDate } from "../zod";
import { ApiError } from "../shared/errors";
import {
  ApiKey,
  ConfigObjectType,
  ConnectorImageConfig,
  DestinationConfig,
  FunctionConfig,
  MiscEntity,
  NotificationChannel,
  ServiceConfig,
  StreamConfig,
  WorkspaceDomain,
} from "./index";
import { assertDefined, createHash, deepMerge, requireDefined } from "juava";
import { checkDomain, checkOrAddToIngress, isDomainAvailable } from "../server/custom-domains";
import { ZodType, ZodTypeDef } from "zod";
import { getServerLog } from "../server/log";
import { getWildcardDomains } from "../../pages/api/[workspaceId]/domain-check";
import { getDestinationSecretPaths, getServiceSecretPaths, maskSecrets, removeMaskedValues } from "./secrets";
import { db } from "../server/db";
import { ConfigApiDeleteOptions } from "../useApi";
import pick from "lodash/pick";

const log = getServerLog("config-objects");

function hashKeys(newKeys: ApiKey[], oldKeys: ApiKey[]): ApiKey[] {
  const oldKeysIndex = Object.values(oldKeys).reduce((acc, key) => ({ ...acc, [key.id]: key }), {});
  return newKeys.map(k => ({
    id: k.id,
    hint: k.hint,
    hash: k.hash
      ? k.hash
      : k.plaintext
      ? createHash(k.plaintext)
      : requireDefined(oldKeysIndex[k.id], `Key with id ${k.id} should either be known, or hash a plaintext value`)
          .hash,
  }));
}

/**
 * Handles linked connections check and deletion for stream, destination, and service objects.
 * This is a shared method used by onDelete handlers.
 */
export async function handleLinkedConnections(
  workspaceId: string,
  objectId: string,
  objectType: string,
  options?: ConfigApiDeleteOptions
): Promise<void> {
  if (!options?.strict && !options?.cascade) {
    return;
  }
  // Check for linked connections
  const linkedConnections = await db.prisma().configurationObjectLink.findMany({
    where: {
      workspaceId,
      deleted: false,
      OR: [{ fromId: objectId }, { toId: objectId }],
    },
  });
  if (linkedConnections.length === 0) {
    return;
  }

  // Cascade takes precedence over strict
  if (options?.cascade) {
    // Delete all linked connections before deleting the object.
    // Sync deletions are picked up by syncctl on its next /api/admin/export/syncs poll.
    for (const link of linkedConnections) {
      await db.prisma().configurationObjectLink.update({
        where: { id: link.id },
        data: { deleted: true },
      });
    }
  } else if (options?.strict) {
    throw new ApiError(
      `Cannot delete ${objectType} because it has ${linkedConnections.length} linked connections`,
      {
        code: "LINKED_CONNECTIONS_EXIST",
        linkedConnectionsCount: linkedConnections.length,
        linkedConnections: linkedConnections.map(link => ({
          id: link.id,
          type: link.type || "push",
          fromId: link.fromId,
          toId: link.toId,
        })),
      },
      { status: 409 }
    );
  }
}

export function parseObject(type: string, obj: any): any {
  const configType = getConfigObjectType(type);
  assertDefined(configType, `Unknown config object type ${type}`);
  const parseResult = safeParseWithDate(configType.schema, obj);
  if (!parseResult.success) {
    throw new ApiError(`Failed to validate schema of ${type}`, { object: obj, error: parseResult.error });
  }
  const topLevelObject = parseResult.data;
  //we're parsing same object twice here, but it's not a big deal
  const narrowParseResult = configType.narrowSchema(topLevelObject, configType.schema).safeParse(obj);
  if (!narrowParseResult.success) {
    throw new ApiError(`Failed to validate schema of ${type}`, { object: obj, error: narrowParseResult.error });
  }
  return narrowParseResult.data;
}

export type OptionalKeys<T> = {
  [K in keyof T]-?: undefined extends { [K2 in keyof T]: K2 }[K] ? K : never;
}[keyof T];

export const getAllConfigObjectTypeNames = (): string[] => {
  return Object.keys(configObjectTypes);
};

export const getConfigObjectType: (type: string) => Required<ConfigObjectType> = type => {
  const configType = configObjectTypes[type];
  assertDefined(configType, `Unknown config object type ${type}`);
  //This crazy type really means "give me all optional properties, for which we need provide a default values"
  const defaults: Required<Pick<ConfigObjectType, OptionalKeys<ConfigObjectType>>> = {
    narrowSchema: function (obj, originalSchema): ZodType<any, ZodTypeDef, any> {
      return originalSchema;
    },
    inputFilter: async function (val: any) {
      return val;
    },
    merge: async function (original: any, patch: Partial<any>) {
      return deepMerge(original, patch);
    },
    outputFilter: async function (original: any) {
      return original;
    },
    onDelete: async function (_original: any, _options?: ConfigApiDeleteOptions) {},
  };

  return { ...defaults, ...configType };
};

const configObjectTypes: Record<string, ConfigObjectType> = {
  destination: {
    schema: DestinationConfig,
    outputFilter: async (obj: DestinationConfig) => {
      if (obj.provisioned) {
        return pick(obj, "id", "type", "workspaceId", "name", "destinationType", "provisioned");
      } else {
        // Mask secrets for non-provisioned destinations
        const secretPaths = getDestinationSecretPaths(obj.destinationType);
        return maskSecrets(obj, secretPaths);
      }
    },
    merge: async (original: DestinationConfig, patch: Partial<DestinationConfig>): Promise<any> => {
      if (patch.provisioned) {
        throw new ApiError(`Can't set destination to provisioned destination through API (${original.id})`);
      }
      // Remove masked values before merge
      const secretPaths = getDestinationSecretPaths(original.destinationType);
      const cleanedPatch = removeMaskedValues(patch, secretPaths);
      return deepMerge(original, cleanedPatch);
    },

    inputFilter: async (obj: DestinationConfig, context) => {
      if (context === "create" && obj.provisioned) {
        throw new ApiError(`Can't create provisioned destination through API (${obj.id})`);
      }
      // Remove masked values
      const secretPaths = getDestinationSecretPaths(obj.destinationType);
      return removeMaskedValues(obj, secretPaths);
    },
    narrowSchema: obj => {
      const type = obj.destinationType;
      const destinationType = coreDestinationsMap[type];
      assertDefined(destinationType, `Unknown destination type ${type}`);
      return DestinationConfig.merge(destinationType.credentials);
    },
    onDelete: async (original: DestinationConfig, options) => {
      await handleLinkedConnections(original.workspaceId, original.id, "destination", options);
    },
  },
  stream: {
    schema: StreamConfig,
    merge(original: any, patch: Partial<any>): any {
      const merged = {
        ...original,
        ...patch,
        privateKeys: patch.privateKeys
          ? hashKeys(patch.privateKeys, original.privateKeys || [])
          : original.privateKeys || [],
        publicKeys: patch.publicKeys
          ? hashKeys(patch.publicKeys, original.publicKeys || [])
          : original.publicKeys || [],
      };
      // TODO: dirty workaround for not be able to clear authorizedJavaScriptDomains
      if (!patch.authorizedJavaScriptDomains) {
        delete merged.authorizedJavaScriptDomains;
      }
      return merged;
    },

    inputFilter: async (obj, _, workspace) => {
      const workspaceId = workspace.id;
      outer: for (const domain of obj.domains || []) {
        const domainToCheck = domain.trim().toLowerCase();
        if (!checkDomain(domainToCheck)) {
          log.atWarn().log(`Domain '${domainToCheck}' is not a valid domain name`);
          throw new ApiError(`Domain ${domainToCheck} is not a valid domain name`);
        }
        const domainAvailability = await isDomainAvailable(domainToCheck, workspace);
        if (!domainAvailability.available) {
          log
            .atWarn()
            .log(
              `Domain ${domainToCheck} can't be added to workspace ${workspaceId}, it is already in use by other workspaces: ${domainAvailability.usedInWorkspace}`
            );
          throw new ApiError(`Domain ${domainToCheck} is already in use by other workspace`);
        }
        const wildcardDomains = await getWildcardDomains(workspaceId);
        for (const wildcardDomain of wildcardDomains) {
          if (domainToCheck.endsWith(wildcardDomain.toLowerCase().replace("*", ""))) {
            log
              .atInfo()
              .log(
                `No need to check ingress status for ${domainToCheck} since it is under wildcard domain: ${wildcardDomain}`
              );
            continue outer;
          }
        }
        try {
          const ingressStatus = await checkOrAddToIngress(domainToCheck);
          log.atInfo().log(`Ingress status for ${domainToCheck}: ${JSON.stringify(ingressStatus)}`);
          if (!ingressStatus) {
            log.atWarn().log(`Incorrect ingress status ${domainToCheck} is not valid`);
          }
        } catch (e) {
          log.atError().withCause(e).log(`Error checking ingress status for ${domainToCheck}`);
        }
      }
      return {
        ...obj,
        domains: obj.domains?.map(d => d.trim().toLowerCase()) || [],
        privateKeys: hashKeys(obj.privateKeys || [], []),
        publicKeys: hashKeys(obj.publicKeys || [], []),
      };
    },
    outputFilter: async (original: StreamConfig) => {
      return {
        ...original,
        domains: original.domains?.map(d => d.trim().toLowerCase()),
        privateKeys: (original.privateKeys || []).map(k => ({ ...k, plaintext: undefined, hash: undefined })),
        publicKeys: (original.publicKeys || []).map(k => ({ ...k, plaintext: undefined, hash: undefined })),
      };
    },
    onDelete: async (original: StreamConfig, options) => {
      await handleLinkedConnections(original.workspaceId, original.id, "stream", options);
    },
  },
  function: {
    schema: FunctionConfig,
    onDelete: async (original: FunctionConfig, options) => {
      if (!options?.strict) {
        return;
      }

      // Check if function is used in any connections
      const allLinks = await db.prisma().configurationObjectLink.findMany({
        where: { workspaceId: original.workspaceId, deleted: false, type: "push" },
      });

      const connectionsUsingFunction = allLinks.filter(link => {
        const functions = link.data?.["functions"];
        if (Array.isArray(functions)) {
          return functions.some((f: any) => f.functionId === "udf." + original.id);
        }
        return false;
      });

      // Check if function is used in any profile builders
      const profileBuilders = await db.prisma().profileBuilder.findMany({
        where: { workspaceId: original.workspaceId, deleted: false },
      });

      const profileBuildersUsingFunction = profileBuilders.filter(pb => {
        const functions = pb.connectionOptions?.["functions"];
        if (Array.isArray(functions)) {
          return functions.some((f: any) => f.functionId === "udf." + original.id);
        }
        return false;
      });

      if (connectionsUsingFunction.length > 0 || profileBuildersUsingFunction.length > 0) {
        throw new ApiError(
          `Cannot delete function because it is being used by ${connectionsUsingFunction.length} connection(s) and ${profileBuildersUsingFunction.length} profile builder(s)`,
          {
            code: "FUNCTION_IN_USE",
            connectionsCount: connectionsUsingFunction.length,
            profileBuildersCount: profileBuildersUsingFunction.length,
            connections: connectionsUsingFunction.map(link => ({
              id: link.id,
              type: link.type || "push",
              fromId: link.fromId,
              toId: link.toId,
            })),
            profileBuilders: profileBuildersUsingFunction.map(pb => ({
              id: pb.id,
              name: pb.name,
            })),
          },
          { status: 409 }
        );
      }
    },
  },
  service: {
    schema: ServiceConfig,
    outputFilter: async (obj: ServiceConfig) => {
      // Mask secrets for services
      const secretPaths = await getServiceSecretPaths(obj.package, obj.version);
      return maskSecrets(obj, secretPaths);
    },
    merge: async (original: ServiceConfig, patch: Partial<ServiceConfig>): Promise<any> => {
      // Remove masked values before merge
      const secretPaths = await getServiceSecretPaths(original.package, original.version);
      const cleanedPatch = removeMaskedValues(patch, secretPaths);
      return deepMerge(original, cleanedPatch);
    },
    inputFilter: async (obj: ServiceConfig) => {
      // Remove masked values
      const secretPaths = await getServiceSecretPaths(obj.package, obj.version);
      return removeMaskedValues(obj, secretPaths);
    },
    onDelete: async (original: ServiceConfig, options) => {
      await handleLinkedConnections(original.workspaceId, original.id, "service", options);
    },
  },
  "custom-image": {
    schema: ConnectorImageConfig,
  },
  domain: {
    schema: WorkspaceDomain,
    inputFilter: async obj => {
      const domainToCheck = obj.name.trim().toLowerCase();
      if (!checkDomain(domainToCheck)) {
        log.atWarn().log(`Domain '${domainToCheck}' is not a valid domain name`);
        throw new ApiError(`Domain ${domainToCheck} is not a valid domain name`);
      }
      return {
        ...obj,
        name: domainToCheck,
      };
    },
    outputFilter: async (original: WorkspaceDomain) => {
      return {
        ...original,
        name: original.name.trim().toLowerCase(),
      };
    },
  },
  misc: {
    schema: MiscEntity,
  },
  notification: {
    schema: NotificationChannel,
  },
} as const;
