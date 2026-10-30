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
  ModelConfig,
  NotificationChannel,
  ServiceConfig,
  StreamConfig,
  WorkspaceDomain,
} from "./index";
import { assertDefined, createHash, deepMerge, requireDefined } from "juava";
import { checkDomain, isDomainAvailable } from "../server/custom-domains";
import { ZodType, ZodTypeDef } from "zod";
import { getServerLog } from "../server/log";
import { getDestinationSecretPaths, getServiceSecretPaths, maskSecrets, removeMaskedValues } from "./secrets";
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

export function parseObject(type: string, obj: any): any {
  const configType = getConfigObjectType(type);
  assertDefined(configType, `Unknown config object type ${type}`);
  const parseResult = safeParseWithDate(configType.schema, obj);
  if (!parseResult.success) {
    throw new ApiError(`Failed to validate schema of ${type}`, {
      responseObject: { object: obj, error: parseResult.error },
    });
  }
  const topLevelObject = parseResult.data;
  //we're parsing same object twice here, but it's not a big deal
  const narrowParseResult = configType.narrowSchema(topLevelObject, configType.schema).safeParse(obj);
  if (!narrowParseResult.success) {
    throw new ApiError(`Failed to validate schema of ${type}`, {
      responseObject: { object: obj, error: narrowParseResult.error },
    });
  }
  return narrowParseResult.data;
}

export type OptionalKeys<T> = {
  [K in keyof T]-?: undefined extends { [K2 in keyof T]: K2 }[K] ? K : never;
}[keyof T];

export const getAllConfigObjectTypeNames = (): string[] => {
  return Object.keys(configObjectTypes);
};

// Own-key lookup: a plain-object registry inherits Object.prototype, so a bare
// index would resolve e.g. "toString" to a function and defeat the 404 guards.
export const getConfigObjectTypeNonStrict = (type: string): ConfigObjectType | undefined =>
  Object.prototype.hasOwnProperty.call(configObjectTypes, type) ? configObjectTypes[type] : undefined;

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
  };

  return { ...defaults, ...configType };
};

const configObjectTypes: Record<string, ConfigObjectType> = {
  model: {
    schema: ModelConfig,
    // Preserve explicit replacement/clearing of optional cursor/delete fields.
    merge: async (original, patch) => {
      const merged = { ...original, ...patch };
      // JSON null is the API's explicit clearing operation for optional fields.
      if (merged.cursor === null) delete merged.cursor;
      if (merged.deleteColumn === null) delete merged.deleteColumn;
      return merged;
    },
  },
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
      for (const domain of obj.domains || []) {
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
  },
  function: {
    schema: FunctionConfig,
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
  },
  "custom-image": {
    schema: ConnectorImageConfig,
  },
  domain: {
    schema: WorkspaceDomain,
    inputFilter: async (obj, _, workspace) => {
      const domainToCheck = obj.name.trim().toLowerCase();
      if (!checkDomain(domainToCheck)) {
        log.atWarn().log(`Domain '${domainToCheck}' is not a valid domain name`);
        throw new ApiError(`Domain ${domainToCheck} is not a valid domain name`);
      }
      // Same rule as for stream domains: export merges domain objects into every stream,
      // so a name claimed by another workspace would route that workspace's events here
      const domainAvailability = await isDomainAvailable(domainToCheck, workspace);
      if (!domainAvailability.available) {
        log
          .atWarn()
          .log(
            `Domain ${domainToCheck} can't be added to workspace ${workspace.id}, it is already in use by other workspaces: ${domainAvailability.usedInWorkspace}`
          );
        throw new ApiError(`Domain ${domainToCheck} is already in use by other workspace`);
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
