import { getServerLog } from "./log";
import { db } from "./db";
import { OidcProviderDbModel } from "./oidc-token-service";

const log = getServerLog("oidc-discovery");

export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri: string;
  introspection_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
  [key: string]: any;
}

/**
 * Fetches OIDC discovery document from the well-known endpoint
 * @param issuer The OIDC issuer URL
 * @returns The discovery document or null if failed
 */
export async function fetchOidcDiscovery(issuer: string): Promise<OidcDiscoveryDocument | null> {
  try {
    // Ensure issuer doesn't end with a slash for the well-known URL
    const normalizedIssuer = issuer.replace(/\/$/, "");
    const wellKnownUrl = `${normalizedIssuer}/.well-known/openid-configuration`;

    log.atInfo().log("Fetching OIDC discovery document", { wellKnownUrl });

    const response = await fetch(wellKnownUrl);

    if (!response.ok) {
      log.atWarn().log("Failed to fetch OIDC discovery document", {
        status: response.status,
        statusText: response.statusText,
        issuer,
      });
      return null;
    }

    const discovery: OidcDiscoveryDocument = await response.json();

    // Validate that the discovery document has required fields
    if (!discovery.authorization_endpoint || !discovery.token_endpoint) {
      log.atWarn().log("Invalid OIDC discovery document - missing required endpoints", {
        issuer,
        hasAuthEndpoint: !!discovery.authorization_endpoint,
        hasTokenEndpoint: !!discovery.token_endpoint,
        hasJwksUri: !!discovery.jwks_uri,
      });
      return null;
    }

    log.atInfo().log("Successfully fetched OIDC discovery document", { issuer });
    return discovery;
  } catch (error) {
    log.atError().withCause(error).log("Error fetching OIDC discovery document", { issuer });
    return null;
  }
}

/**
 * Updates OIDC provider with discovered endpoints
 * @param providerId The provider ID in database
 * @param discovery The discovery document
 * @returns true if updated successfully
 */
export async function updateProviderWithDiscovery(
  providerId: string,
  discovery: OidcDiscoveryDocument
): Promise<boolean> {
  try {
    await db.prisma().oidcProvider.update({
      where: { id: providerId },
      data: {
        authorizationEndpoint: discovery.authorization_endpoint,
        tokenEndpoint: discovery.token_endpoint,
        userinfoEndpoint: discovery.userinfo_endpoint,
        jwksUri: discovery.jwks_uri,
        introspectionEndpoint: discovery.introspection_endpoint,
      },
    });

    log.atInfo().log("Updated OIDC provider with discovered endpoints", { providerId });
    return true;
  } catch (error) {
    log.atError().withCause(error).log("Failed to update OIDC provider with discovery", { providerId });
    return false;
  }
}

/**
 * Performs OIDC auto-discovery and updates provider if needed
 * @param provider The OIDC provider configuration
 * @returns The discovery document or null if auto-discovery is disabled or failed
 */
export async function performAutoDiscovery(provider: OidcProviderDbModel): Promise<OidcDiscoveryDocument | null> {
  if (!provider.autoDiscovery) {
    return null;
  }
  const discovery = await fetchOidcDiscovery(provider.issuer);
  if (discovery) {
    await updateProviderWithDiscovery(provider.id, discovery);
  }

  return discovery;
}
