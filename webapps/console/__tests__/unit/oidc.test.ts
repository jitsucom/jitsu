import { describe, expect, it } from "vitest";
import { OIDCProvider, ParseJSONConfigFromEnv } from "../../lib/oidc";
import type { OIDCConfig, OIDCProfile } from "../../lib/oidc";

const clientConfig = {
  clientId: "entra-client-id",
  clientSecret: "entra-client-secret",
};

describe("OIDCProvider", () => {
  it.each([
    {
      name: "tenant-specific",
      issuer: "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0",
      discovery:
        "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0/.well-known/openid-configuration",
    },
    {
      name: "common",
      issuer: "https://login.microsoftonline.com/common/v2.0/",
      discovery: "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration",
    },
  ])("configures an Entra $name issuer through generic OIDC", ({ issuer, discovery }) => {
    const provider = OIDCProvider({ ...clientConfig, issuer });

    expect(provider.id).toBe("oidc");
    expect(provider.wellKnown).toBe(discovery);
    expect(provider.authorization).toEqual({ params: { scope: "openid email profile" } });
    expect(provider.checks).toEqual(["pkce", "state"]);
  });

  it("maps an explicit email claim", async () => {
    const provider = OIDCProvider({
      ...clientConfig,
      issuer: "https://login.microsoftonline.com/common/v2.0",
    });
    const profile: OIDCProfile = {
      sub: "entra-user-id",
      name: "Ada Lovelace",
      preferred_username: "ada@example.com",
      email: "verified@example.com",
      picture: "https://example.com/avatar.png",
    };

    expect(await provider.profile(profile, {} as never)).toEqual({
      id: "entra-user-id",
      name: "Ada Lovelace",
      email: "verified@example.com",
      image: "https://example.com/avatar.png",
    });
  });

  it("does not treat preferred_username as an email claim", async () => {
    const provider = OIDCProvider({
      ...clientConfig,
      issuer: "https://login.microsoftonline.com/common/v2.0",
    });
    const profile: OIDCProfile = {
      sub: "entra-user-id",
      preferred_username: "ada@example.com",
    };

    expect(await provider.profile(profile, {} as never)).toEqual({
      id: "entra-user-id",
      name: "ada@example.com",
      email: undefined,
      image: undefined,
    });
  });
});

describe("ParseJSONConfigFromEnv", () => {
  it("parses an Entra issuer as a generic OIDC config", () => {
    const config: OIDCConfig<OIDCProfile> = {
      ...clientConfig,
      issuer: "https://login.microsoftonline.com/common/v2.0",
    };

    expect(ParseJSONConfigFromEnv(JSON.stringify(config))).toEqual(config);
  });

  it.each([undefined, "", '""', "not-json"])("does not enable OIDC for an unusable value", value => {
    expect(ParseJSONConfigFromEnv(value)).toBeUndefined();
  });
});
