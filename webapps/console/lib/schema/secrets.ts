import { coreDestinationsMap } from "./destinations";
import { PropertyUI } from "./destinations";
import { db } from "../server/db";
import { getServerLog } from "../server/log";

const log = getServerLog("secrets");

export const MASKED_SECRET = "__MASKED_BY_JITSU__";

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
      secretPaths.push(`credentials.${fieldName}`);
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

  secretPaths.forEach(path => {
    const parts = path.split(".");
    let current = result;

    for (let i = 0; i < parts.length - 1; i++) {
      if (current && typeof current === "object" && parts[i] in current) {
        current = current[parts[i]];
      } else {
        return; // Path doesn't exist
      }
    }

    const lastPart = parts[parts.length - 1];
    if (current && typeof current === "object" && lastPart in current) {
      current[lastPart] = MASKED_SECRET;
    }
  });

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

  secretPaths.forEach(path => {
    const parts = path.split(".");
    let current = result;
    let parent = null;
    let lastKey = "";

    for (let i = 0; i < parts.length; i++) {
      if (current && typeof current === "object" && parts[i] in current) {
        parent = current;
        lastKey = parts[i];
        current = current[parts[i]];
      } else {
        return; // Path doesn't exist
      }
    }

    // If the value is masked, remove it from the object
    if (current === MASKED_SECRET && parent && lastKey) {
      delete parent[lastKey];
    }
  });

  return result;
}
