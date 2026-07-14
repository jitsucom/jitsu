import type { PrismaClient } from "@prisma/client";
import { checkHash, createHash, randomId } from "juava";

export type RegisteredClient = {
  clientId: string;
  clientSecret: string; // plaintext — returned only at registration time
  name: string;
  redirectUris: string[];
};

// Thin CRUD + secret hashing for OAuthClient rows. Used by OAuthHandlers.
// DI: takes the prisma client in the constructor; never reaches for db.prisma().
export class OAuthClientsRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async register(name: string, redirectUris: string[]): Promise<RegisteredClient> {
    if (!name?.trim()) throw new Error("client_name is required");
    if (!redirectUris.length) throw new Error("redirect_uris must contain at least one URI");
    for (const uri of redirectUris) {
      try {
        // Basic sanity check; consent-time check is the real security gate.
        new URL(uri);
      } catch {
        throw new Error(`Invalid redirect_uri: ${uri}`);
      }
    }
    const clientSecret = randomId({ digits: 48, strongRandom: true });
    const row = await this.prisma.oAuthClient.create({
      data: {
        clientSecretHash: createHash(clientSecret),
        name: name.trim().slice(0, 200),
        redirectUris,
      },
    });
    return { clientId: row.id, clientSecret, name: row.name, redirectUris: row.redirectUris };
  }

  async findById(clientId: string) {
    return this.prisma.oAuthClient.findUnique({ where: { id: clientId } });
  }

  // Returns the client if both id and secret match, otherwise undefined.
  // Pure validation — no side effects.
  async verifyCredentials(clientId: string, clientSecret: string) {
    const client = await this.findById(clientId);
    if (!client) return undefined;
    return checkHash(client.clientSecretHash, clientSecret) ? client : undefined;
  }
}
