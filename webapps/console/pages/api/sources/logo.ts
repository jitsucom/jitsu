import { db } from "../../../lib/server/db";
import { getErrorMessage, getLog, requireDefined } from "juava";
import { jitsuSources } from "./index";

export default async function handler(req, res) {
  try {
    const packageType = (req.query.type as string) || "airbyte";
    const packageId = requireDefined(req.query.package as string, `GET param package is required`);

    const jitsuSource = jitsuSources[packageId];
    if (jitsuSource) {
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
      res.status(200).send(jitsuSource.logoSvg);
      return;
    }

    const data = await db
      .prisma()
      .connectorPackage.findFirst({ where: { packageId, packageType }, select: { logoSvg: true, meta: true } });
    if (!data) {
      const msg = `Icon for ${packageType} - ${packageId} not found`;
      res.status(404).json({ status: 404, message: msg });
    } else if (data.logoSvg) {
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
      res.status(200).send(data.logoSvg);
    } else {
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
      if ((data.meta as any).connectorSubtype === "database") {
        res
          .status(200)
          .send(
            '<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="-40 -60 500 572"  width="100%" xmlns="http://www.w3.org/2000/svg"><path d="M448 73.143v45.714C448 159.143 347.667 192 224 192S0 159.143 0 118.857V73.143C0 32.857 100.333 0 224 0s224 32.857 224 73.143zM448 176v102.857C448 319.143 347.667 352 224 352S0 319.143 0 278.857V176c48.125 33.143 136.208 48.572 224 48.572S399.874 209.143 448 176zm0 160v102.857C448 479.143 347.667 512 224 512S0 479.143 0 438.857V336c48.125 33.143 136.208 48.572 224 48.572S399.874 369.143 448 336z"></path></svg>'
          );
      } else {
        res
          .status(200)
          .send(
            '<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 640 512" width="100%" xmlns="http://www.w3.org/2000/svg"><path d="M537.6 226.6c4.1-10.7 6.4-22.4 6.4-34.6 0-53-43-96-96-96-19.7 0-38.1 6-53.3 16.2C367 64.2 315.3 32 256 32c-88.4 0-160 71.6-160 160 0 2.7.1 5.4.2 8.1C40.2 219.8 0 273.2 0 336c0 79.5 64.5 144 144 144h368c70.7 0 128-57.3 128-128 0-61.9-44-113.6-102.4-125.4z"></path></svg>'
          );
      }
    }
  } catch (e) {
    res.status(500).json({ status: 500, message: getErrorMessage(e) });
    getLog().atError().log(`Failed to get logo for ${req.query.type}/${req.query.package}`, e);
  }
}
