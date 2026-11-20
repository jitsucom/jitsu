import { describe, expect, it } from "vitest";
import { MASKED_SECRET } from "../../lib/schema/destinations";
import { pickOneOfOption } from "../../lib/schema/one-of";

// JITSU-284: a service read while its connector spec was missing has the mask where the saved option was. The editor
// must not pick an option for it: the option's form would write its constant over the mask, and a save would change the
// saved replication method.

const option = (method: string) => ({ title: method, properties: { method: { type: "string", const: method } } });
// CDC first, as the replication methods of the database connectors are listed
const replication = [option("CDC"), option("Xmin"), option("Standard")];

const pick = (value: unknown, name = "replication_method", oneOf: any[] = replication) =>
  pickOneOfOption(oneOf, "method", value, name);

describe("pickOneOfOption", () => {
  it("selects nothing for a masked discriminator, even with CDC listed first", () => {
    const { selected, selectedIdx } = pick(MASKED_SECRET);
    expect(selected).toBeUndefined();
    expect(selectedIdx).toBe(0);
  });

  it("still hides the CDC option from the list of options", () => {
    expect(pick(MASKED_SECRET).removeIdx).toBe(0);
  });

  it("shows the saved option for a saved value", () => {
    expect(pick("Standard").selected.title).toBe("Standard");
    expect(pick("Xmin").selectedIdx).toBe(1);
  });

  it("shows the first other option when the saved value is CDC, or there is none (unchanged)", () => {
    expect(pick("CDC").selected.title).toBe("Xmin");
    expect(pick(undefined).selected.title).toBe("Xmin");
  });

  it("selects nothing for a masked discriminator of any other field, and leaves the others alone (unchanged)", () => {
    expect(pick(MASKED_SECRET, "tunnel_method").selected).toBeUndefined();
    expect(pick("Standard", "tunnel_method").selected.title).toBe("Standard");
    // no saved value at all: an option written with `const` matches `undefined` through `enum?.[0]`, so the first one shows
    expect(pick(undefined, "tunnel_method").selectedIdx).toBe(0);
  });

  it("copes with an enum of one value as the discriminator", () => {
    const withEnum = [{ properties: { method: { enum: ["A"] } } }, { properties: { method: { enum: ["B"] } } }];
    expect(pick("B", "other", withEnum).selectedIdx).toBe(1);
    expect(pick(MASKED_SECRET, "other", withEnum).selected).toBeUndefined();
  });
});
