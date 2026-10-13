import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, request } from "undici";
import { isBlockedAddress } from "@jitsu/core-functions-lib";
import { fromBuffer } from "yauzl";
import { MicrosoftReadError } from "./discovery";

const compressedLimit = 5 * 1024 * 1024;
const expandedLimit = 10 * 1024 * 1024;
const failure = () =>
  new MicrosoftReadError(
    "Microsoft report download was unavailable or exceeded safety limits. Try again or view reporting in Microsoft Advertising."
  );

export function publicReportUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    (isIP(host) && isBlockedAddress(host))
  )
    throw failure();
  return url;
}

/** Microsoft says the signed download hostname may change. Pin public DNS at connection time instead of trusting a domain suffix. */
export async function downloadMicrosoftReport(value: string): Promise<Buffer> {
  const agent = new Agent({
    connect: {
      rejectUnauthorized: true,
      timeout: 10_000,
      lookup(host, options, callback) {
        lookup(host, { all: true }).then(
          addresses => {
            if (!addresses.length || addresses.some(a => isBlockedAddress(a.address)))
              return callback(failure(), "", 0);
            // Node may request all addresses for family autoselection. Each was checked;
            // no second DNS resolution occurs between validation and connection.
            if (typeof options === "object" && options.all)
              (callback as unknown as (error: Error | null, addresses: { address: string; family: number }[]) => void)(
                null,
                addresses
              );
            else callback(null, addresses[0].address, addresses[0].family);
          },
          () => callback(failure(), "", 0)
        );
      },
    },
  });
  try {
    // undici.request does not follow redirects without an explicit redirect interceptor.
    const response = await request(publicReportUrl(value), {
      dispatcher: agent,
      method: "GET",
      signal: AbortSignal.timeout(25_000),
      headersTimeout: 10_000,
      bodyTimeout: 10_000,
    });
    try {
      if (response.statusCode !== 200) throw failure();
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > compressedLimit) throw failure();
        chunks.push(Buffer.from(chunk));
      }
      return await unzipMicrosoftReport(Buffer.concat(chunks));
    } finally {
      response.body.destroy();
    }
  } catch {
    throw failure();
  } finally {
    await agent.destroy();
  }
}

/** One CSV only; never extract provider-controlled filenames onto disk. */
export function unzipMicrosoftReport(buffer: Buffer): Promise<Buffer> {
  if (buffer.length > compressedLimit) return Promise.reject(failure());
  return new Promise((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(failure());
      let result: Buffer | undefined;
      const fail = () => {
        zip.close();
        reject(failure());
      };
      zip.on("error", fail);
      zip.on("entry", entry => {
        if (
          result ||
          !entry.fileName.toLowerCase().endsWith(".csv") ||
          entry.uncompressedSize > expandedLimit ||
          entry.generalPurposeBitFlag & 1
        )
          return fail();
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return fail();
          const chunks: Buffer[] = [];
          let bytes = 0;
          stream.on("error", fail);
          stream.on("data", chunk => {
            bytes += chunk.length;
            if (bytes > expandedLimit) {
              stream.destroy();
              fail();
            } else chunks.push(Buffer.from(chunk));
          });
          stream.on("end", () => {
            result = Buffer.concat(chunks);
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => {
        zip.close();
        result ? resolve(result) : reject(failure());
      });
      zip.readEntry();
    });
  });
}
