import type { OAuthConfig, OAuthUserConfig } from "next-auth/providers/oauth";
import { ApiError } from "./shared/errors";

export interface OIDCProfile extends Record<string, any> {
  sub: string;
  name?: string | null;
  preferred_username?: string | null;
  nickname?: string | null;
  email?: string | null;
  picture?: string | null;
}

export type OIDCConfig<P> = OAuthUserConfig<P> & Required<Pick<OAuthConfig<P>, "issuer">>;

/**
 * Creates an OAuth configuration for an OpenID Connect (OIDC) Discovery compliant provider.
 *
 * @template P - The type of the profile, extending `OIDCProfile`.
 *
 * @param {OIDCConfig<P>} options - The user configuration options for OAuth authentication.
 *
 * @returns {OAuthConfig<P>} - An OIDC provider NextAuthJS valid configuration.
 *
 * @throws {ApiError} - Throws an error if the required fields `issuer`, `clientId`, or `clientSecret`
 * are not provided in the options parameter.
 *
 * @description
 * Initializes an OAuth configuration object for a generic OIDC provider that is compliant with the OIDC Discovery. It requires
 * the `issuer` (the issuer domain in valid URL format), `clientId`, and `clientSecret` fields in the options. This configuration
 * includes default settings for handling the PKCE and state checks and provides
 * a profile extraction mechanism.
 *
 * The well-known configuration endpoint for the provider is automatically set based on the issuer, and
 * the default authorization request includes scopes for OpenID, email, and profile information.
 */
export function OIDCProvider<P extends OIDCProfile>(options: OIDCConfig<P>): OAuthConfig<P> {
  if (!options.issuer || !options.clientId || !options.clientSecret) {
    throw new ApiError("Malformed OIDC config: issuer, clientId, and clientSecret are required");
  }

  return {
    id: "oidc",
    name: "OIDC",
    wellKnown: `${options.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
    type: "oauth",
    authorization: { params: { scope: "openid email profile" } },
    checks: ["pkce", "state"],
    idToken: true,
    profile(profile) {
      return {
        id: profile.sub,
        name: profile.name ?? profile.preferred_username ?? profile.nickname,
        // Do not fall back to preferred_username: it is mutable and is not
        // guaranteed to be an email address, while Jitsu uses email for invitations.
        email: profile.email,
        image: profile.picture,
      };
    },
    options,
  };
}

export function ParseJSONConfigFromEnv<P extends OIDCProfile>(env?: string): OIDCConfig<P> | undefined {
  try {
    return env && env !== '""' ? (JSON.parse(env) as OIDCConfig<P>) : undefined;
  } catch (error: unknown) {
    console.error("Failed to parse JSON config from env", error);
    return undefined;
  }
}
