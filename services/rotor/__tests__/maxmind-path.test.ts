import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as tar from "tar";
import { expect, test } from "vitest";
import { loadFromPath } from "../src/lib/maxmind";

const cityDb = Buffer.from("fake-city-db");

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "maxmind-test-"));

test("loadFromPath loads <edition>.mmdb from a directory", async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "GeoLite2-City.mmdb"), cityDb);
  expect(await loadFromPath(dir, "GeoLite2-City")).toEqual(cityDb);
  await expect(loadFromPath(dir, "GeoLite2-Country")).rejects.toThrow(
    "neither GeoLite2-Country.mmdb nor GeoLite2-Country.tar.gz found"
  );
});

test("loadFromPath loads a single .mmdb file named after its edition", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "GeoIP2-City.mmdb");
  fs.writeFileSync(file, cityDb);
  expect(await loadFromPath(file, "GeoIP2-City")).toEqual(cityDb);
  await expect(loadFromPath(file, "GeoIP2-Country")).rejects.toThrow("doesn't contain GeoIP2-Country edition");
});

test("loadFromPath extracts .mmdb from a tar.gz archive", async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "GeoLite2-City.mmdb"), cityDb);
  await tar.c({ gzip: true, file: path.join(dir, "GeoLite2-City.tar.gz"), cwd: dir }, ["GeoLite2-City.mmdb"]);
  fs.rmSync(path.join(dir, "GeoLite2-City.mmdb"));
  expect(await loadFromPath(dir, "GeoLite2-City")).toEqual(cityDb);
});

test("loadFromPath fails on a missing path", async () => {
  await expect(loadFromPath(path.join(tmpDir(), "nope"), "GeoLite2-City")).rejects.toThrow();
});
