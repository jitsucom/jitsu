import { db } from "../../../lib/server/db";
import { getErrorMessage, requireDefined } from "juava";

export default async function handler(req, res) {
  try {
    const packageType = (req.query.type as string) || "airbyte";
    const packageId = requireDefined(req.query.package as string, `GET param package is required`);

    const data = await db
      .prisma()
      .connectorPackage.findFirst({ where: { packageId, packageType }, select: { logoSvg: true } });
    if (!data) {
      const msg = `Icon for ${packageType} - ${packageId} not found`;
      res.status(404).json({ status: 404, message: msg });
    } else {
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
      res.status(200).send(data.logoSvg);
    }
  } catch (e) {
    res.status(500).json({ status: 500, message: getErrorMessage(e) });
  }
}
