import { db } from "../../../lib/server/db";
import { getErrorMessage, getLog, requireDefined } from "juava";
import { jitsuSources, externalSources } from "./index";

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
    const externalSource = externalSources[packageId];
    if (externalSource) {
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
      res.status(200).send(externalSource.logoSvg);
      return;
    }

    const data = await db
      .prisma()
      .connectorPackage.findFirst({ where: { packageId, packageType }, select: { logoSvg: true, meta: true } });
    if (data?.logoSvg) {
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
      res.status(200).send(Buffer.from(data.logoSvg).toString());
    } else {
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
      if ((data?.meta as any)?.connectorSubtype === "database") {
        res
          .status(200)
          .send(
            '<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="-40 -60 500 572"  width="100%" xmlns="http://www.w3.org/2000/svg"><path d="M448 73.143v45.714C448 159.143 347.667 192 224 192S0 159.143 0 118.857V73.143C0 32.857 100.333 0 224 0s224 32.857 224 73.143zM448 176v102.857C448 319.143 347.667 352 224 352S0 319.143 0 278.857V176c48.125 33.143 136.208 48.572 224 48.572S399.874 209.143 448 176zm0 160v102.857C448 479.143 347.667 512 224 512S0 479.143 0 438.857V336c48.125 33.143 136.208 48.572 224 48.572S399.874 369.143 448 336z"></path></svg>'
          );
      } else {
        res
          .status(200)
          .send(
            '<svg stroke="currentColor" fill="currentColor" viewBox="0 0 640 512" width="100%" xmlns="http://www.w3.org/2000/svg"><path d="M349.9 236.3h-66.1v-59.4h66.1v59.4zm0-204.3h-66.1v60.7h66.1V32zm78.2 144.8H362v59.4h66.1v-59.4zm-156.3-72.1h-66.1v60.1h66.1v-60.1zm78.1 0h-66.1v60.1h66.1v-60.1zm276.8 100c-14.4-9.7-47.6-13.2-73.1-8.4-3.3-24-16.7-44.9-41.1-63.7l-14-9.3-9.3 14c-18.4 27.8-23.4 73.6-3.7 103.8-8.7 4.7-25.8 11.1-48.4 10.7H2.4c-8.7 50.8 5.8 116.8 44 162.1 37.1 43.9 92.7 66.2 165.4 66.2 157.4 0 273.9-72.5 328.4-204.2 21.4 .4 67.6 .1 91.3-45.2 1.5-2.5 6.6-13.2 8.5-17.1l-13.3-8.9zm-511.1-27.9h-66v59.4h66.1v-59.4zm78.1 0h-66.1v59.4h66.1v-59.4zm78.1 0h-66.1v59.4h66.1v-59.4zm-78.1-72.1h-66.1v60.1h66.1v-60.1z"/></svg>'
          );
      }
    }
  } catch (e) {
    res.status(500).json({ status: 500, message: getErrorMessage(e) });
    getLog().atError().log(`Failed to get logo for ${req.query.type}/${req.query.package}`, e);
  }
}
