import { describe, it, expect } from "@jest/globals";
import { getDestinationSecretPaths, maskSecrets, removeMaskedValues, MASKED_SECRET } from "../secrets";

describe("secrets", () => {
  describe("getDestinationSecretPaths", () => {
    it("should return password paths for postgres destination", () => {
      const paths = getDestinationSecretPaths("postgres");
      expect(paths).toContain("credentials.password");
    });

    it("should return password paths for clickhouse destination", () => {
      const paths = getDestinationSecretPaths("clickhouse");
      expect(paths).toContain("credentials.password");
    });

    it("should return empty array for unknown destination", () => {
      const paths = getDestinationSecretPaths("unknown");
      expect(paths).toEqual([]);
    });
  });

  describe("maskSecrets", () => {
    it("should mask secret fields", () => {
      const obj = {
        id: "test",
        credentials: {
          host: "localhost",
          username: "user",
          password: "secret123",
          database: "mydb",
        },
      };

      const masked = maskSecrets(obj, ["credentials.password"]);

      expect(masked.credentials.password).toBe(MASKED_SECRET);
      expect(masked.credentials.username).toBe("user");
      expect(masked.credentials.host).toBe("localhost");
    });

    it("should handle nested paths", () => {
      const obj = {
        id: "test",
        credentials: {
          auth: {
            token: "secret-token",
            apiKey: "api-key-123",
          },
        },
      };

      const masked = maskSecrets(obj, ["credentials.auth.token"]);

      expect(masked.credentials.auth.token).toBe(MASKED_SECRET);
      expect(masked.credentials.auth.apiKey).toBe("api-key-123");
    });

    it("should handle missing paths gracefully", () => {
      const obj = {
        id: "test",
        credentials: {
          host: "localhost",
        },
      };

      const masked = maskSecrets(obj, ["credentials.password"]);

      expect(masked).toEqual(obj);
    });
  });

  describe("removeMaskedValues", () => {
    it("should remove masked values", () => {
      const obj = {
        id: "test",
        credentials: {
          host: "localhost",
          username: "user",
          password: MASKED_SECRET,
          database: "mydb",
        },
      };

      const cleaned = removeMaskedValues(obj, ["credentials.password"]);

      expect(cleaned.credentials.password).toBeUndefined();
      expect(cleaned.credentials.username).toBe("user");
      expect(cleaned.credentials.host).toBe("localhost");
    });

    it("should not remove non-masked values", () => {
      const obj = {
        id: "test",
        credentials: {
          host: "localhost",
          username: "user",
          password: "new-password",
          database: "mydb",
        },
      };

      const cleaned = removeMaskedValues(obj, ["credentials.password"]);

      expect(cleaned.credentials.password).toBe("new-password");
      expect(cleaned.credentials.username).toBe("user");
    });

    it("should handle nested paths", () => {
      const obj = {
        id: "test",
        credentials: {
          auth: {
            token: MASKED_SECRET,
            apiKey: "api-key-123",
          },
        },
      };

      const cleaned = removeMaskedValues(obj, ["credentials.auth.token"]);

      expect(cleaned.credentials.auth.token).toBeUndefined();
      expect(cleaned.credentials.auth.apiKey).toBe("api-key-123");
    });
  });
});
