import { coreDestinationsMap } from "./destinations";
import { safeParseWithDate } from "../zod";
import { ApiError } from "../shared/errors";
import { ApiKey, ConfigObjectType, DestinationConfig, FunctionConfig, StreamConfig } from "./index";
import { assertDefined, createHash, requireDefined } from "juava";
import { isDomainAvailable } from "../server/custom-domains";
import { ZodType, ZodTypeDef } from "zod";
import { getServerLog } from "../server/log";

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
    merge: function (original: any, patch: Partial<any>) {
      return { ...original, ...patch };
    },
    outputFilter: function (original: any) {
      return original;
    },
  };

  return { ...defaults, ...configType };
};

const configObjectTypes: Record<string, ConfigObjectType> = {
  destination: {
    schema: DestinationConfig,
    outputFilter: (obj: DestinationConfig) => {
      const newObject = { ...obj };
      if (newObject.provisioned) {
        delete (newObject as any).credentials;
      }
      return newObject;
    },
    merge(original: DestinationConfig, patch: Partial<DestinationConfig>): any {
      if (patch.provisioned) {
        throw new ApiError(`Can't set destination to provisioned destination through API (${original.id})`);
      }
      return { ...original, ...patch };
    },

    inputFilter: async (obj: DestinationConfig, context) => {
      if (context === "create" && obj.provisioned) {
        throw new ApiError(`Can't create provisioned destination through API (${obj.id})`);
      }
      return obj;
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
      return {
        ...original,
        ...patch,
        privateKeys: patch.privateKeys
          ? hashKeys(patch.privateKeys, original.privateKeys || [])
          : original.privateKeys || [],
        publicKeys: patch.publicKeys
          ? hashKeys(patch.publicKeys, original.publicKeys || [])
          : original.publicKeys || [],
      };
    },

    inputFilter: async obj => {
      const workspaceId = obj.workspaceId;
      for (const domain of obj.domains || []) {
        const domainAvailability = await isDomainAvailable(domain, workspaceId);
        if (!domainAvailability.available) {
          log
            .atWarn()
            .log(
              `Domain ${domain} can't be added to workspace ${workspaceId}, it is already in use by other workspaces: ${domainAvailability.usedInWorkspace}`
            );
          throw new ApiError(`Domain ${domain} is already in use by other workspace`);
        }
      }
      return {
        ...obj,
        privateKeys: hashKeys(obj.privateKeys || [], []),
        publicKeys: hashKeys(obj.publicKeys || [], []),
      };
    },
    outputFilter: (original: StreamConfig) => {
      return {
        ...original,
        domains: original.domains?.map(d => d.toLowerCase()),
        privateKeys: (original.privateKeys || []).map(k => ({ ...k, plaintext: undefined, hash: undefined })),
        publicKeys: (original.publicKeys || []).map(k => ({ ...k, plaintext: undefined, hash: undefined })),
      };
    },
  },
  function: {
    schema: FunctionConfig,
  },
} as const;
