import { coreDestinationsMap, MASKED_SECRET } from "./destinations";
import { PropertyUI } from "./destinations";
import { db } from "../server/db";
import { getServerLog } from "../server/log";
import get from "lodash/get";
import set from "lodash/set";
import unset from "lodash/unset";

import isPlainObject from "lodash/isPlainObject";

const log = getServerLog("secrets");

/**
 * Get all secret field paths for a destination type
 */
export function getDestinationSecretPaths(destinationType: string): string[] {
  const destination = coreDestinationsMap[destinationType];
  if (!destination) {
    return [];
  }

  const secretPaths: string[] = [];
  const credentialsUi = destination.credentialsUi || {};

  // Check each field in credentialsUi for password: true
  Object.entries(credentialsUi).forEach(([fieldName, fieldUi]) => {
    const ui = fieldUi as PropertyUI;
    if (ui.password) {
      secretPaths.push(fieldName);
    }
  });

  return secretPaths;
}

/**
 * Get all secret field paths for a service (Airbyte source)
 */
export async function getServiceSecretPaths(packageName: string, version: string): Promise<string[]> {
  try {
    const sourceSpec = await db.prisma().source_spec.findUnique({
      where: {
        package_version: {
          package: packageName,
          version: version,
        },
      },
    });

    if (!sourceSpec || !sourceSpec.specs) {
      return [];
    }

    const specs = sourceSpec.specs as any;
    const connectionSpec = specs.connectionSpecification;
    if (!connectionSpec || !connectionSpec.properties) {
      return [];
    }

    const secretPaths: string[] = [];

    // Recursively find all fields with airbyte_secret: true
    function findSecretFields(properties: any, basePath: string = "") {
      Object.entries(properties).forEach(([key, schema]: [string, any]) => {
        const currentPath = basePath ? `${basePath}.${key}` : key;

        if (schema.airbyte_secret === true) {
          secretPaths.push(`credentials.${currentPath}`);
        }

        // Handle oneOf/anyOf schemas
        if (schema.oneOf || schema.anyOf) {
          const options = schema.oneOf || schema.anyOf;
          options.forEach((option: any) => {
            if (option.properties) {
              findSecretFields(option.properties, currentPath);
            }
          });
        }

        // Recurse into nested objects
        if (schema.type === "object" && schema.properties) {
          findSecretFields(schema.properties, currentPath);
        }
      });
    }

    findSecretFields(connectionSpec.properties);
    return secretPaths;
  } catch (error) {
    log.atError().withCause(error).log(`Failed to get service secret paths for ${packageName}@${version}`);
    return [];
  }
}

/**
 * Mask secret values in an object based on the field paths
 */
export function maskSecrets(obj: any, secretPaths: string[]): any {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  const result = JSON.parse(JSON.stringify(obj)); // Deep clone

  for (const path of secretPaths) {
    const value = get(obj, path);
    if (typeof value !== "undefined") {
      set(result, path, MASKED_SECRET); // We don't mask non-set values
    }
  }

  return result;
}

/**
 * Remove masked values from an object before merge
 */
export function removeMaskedValues(obj: any, secretPaths: string[]): any {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  const result = JSON.parse(JSON.stringify(obj)); // Deep clone

  for (const path of secretPaths) {
    const value = get(obj, path);
    if (value === MASKED_SECRET) {
      unset(result, path); // Remove the masked value
    }
  }

  return result;
}

/**
 * Recursively replaces all occurrences of MASKED_SECRET in object with actual values from dbEntity.
 *
 * @param object - The d object being sent
 * @param dbEntity - The original entity from database containing real secret values
 * @returns A new object with masked secrets replaced by values from db
 */
export function unmaskSecretsFromOriginal(object: any, dbEntity: any): any {
  if (!object || !dbEntity) {
    return object;
  }

  // Deep clone object to avoid mutating the original
  const result = JSON.parse(JSON.stringify(object));

  // Recursively find and replace masked secrets
  replaceMaskedSecrets(result, dbEntity, []);

  return result;
}

/**
 * Recursively walks through an object and replaces MASKED_SECRET values with actual values from dbEntity
 *
 * @param obj - Current object being processed
 * @param dbEntity - Original entity from database
 * @param path - Current path in the object structure
 */
function replaceMaskedSecrets(obj: any, dbEntity: any, path: (string | number)[]): void {
  if (!isPlainObject(obj) && !Array.isArray(obj)) {
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      if (item === MASKED_SECRET) {
        // Replace masked value with value from db at the same path
        const dbValue = get(dbEntity, [...path, index]);
        if (dbValue !== undefined) {
          obj[index] = dbValue;
        }
      } else if (isPlainObject(item) || Array.isArray(item)) {
        replaceMaskedSecrets(item, dbEntity, [...path, index]);
      }
    });
  } else {
    Object.keys(obj).forEach(key => {
      const value = obj[key];
      const currentPath = [...path, key];

      if (value === MASKED_SECRET) {
        // Replace masked value with value from db at the same path
        const dbValue = get(dbEntity, currentPath);
        if (dbValue !== undefined) {
          obj[key] = dbValue;
        }
      } else if (isPlainObject(value) || Array.isArray(value)) {
        replaceMaskedSecrets(value, dbEntity, currentPath);
      }
    });
  }
}

/**
 * Checks if an object contains any masked secrets
 *
 * @param obj - Object to check for masked secrets
 * @returns true if object contains MASKED_SECRET values
 */
export function containsMaskedSecrets(obj: any): boolean {
  if (!obj) {
    return false;
  }

  if (obj === MASKED_SECRET) {
    return true;
  }

  if (Array.isArray(obj)) {
    return obj.some(item => containsMaskedSecrets(item));
  }

  if (isPlainObject(obj)) {
    return Object.values(obj).some(value => containsMaskedSecrets(value));
  }

  return false;
}
