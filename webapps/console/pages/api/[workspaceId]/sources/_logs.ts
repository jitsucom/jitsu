import { db } from "../../../../lib/server/db";
import { randomId } from "juava";
import dayjs from "dayjs";
import { Duplex } from "stream";

export const config = {
  runtime: "edge",
};

export default async function handler(req: Request) {
  console.log("req", req.url);
  try {
    //create byte buffer
    const duplex = new Duplex();
    // res.setHeader("Content-Type", "text/plain");
    // if (query.download) {
    //   res.setHeader("Content-Disposition", `attachment; filename=log_sync_${query.syncId}_task_${query.taskId}.txt`);
    // }
    const load = async () => {
      await db.pgHelper().streamQuery(
        `select *
                              from task_log
                              where task_id = :task_id
                              order by timestamp`,
        { task_id: "1a7128c9-5d71-428f-8c6c-d45d00389b7c" },
        r => {
          duplex.write(
            `${dayjs(r.timestamp).utc().format("YYYY-MM-DD HH:mm:ss.SSS")} ${r.level} [${r.logger}] ${r.message}\n`
          );
        }
      );
      duplex.write("test");
      duplex.end();
    };
    load();
    //stream buffer to response
    const stream = new ReadableStream({
      async pull(controller) {
        const chunk = await duplex.read();
        if (chunk) {
          controller.enqueue(chunk);
        } else {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain",
        "Content-Disposition": `attachment; filename=log_sync_${1}_task_${1}.txt`,
      },
    });
  } catch (e: any) {
    const errorId = randomId();
    console.error(`Error loading logs for task ids ${1} . Error ID: ${errorId}. Error: ${e}`);
    return new Response(
      JSON.stringify({
        ok: false,
        error: `couldn't load tasks due to internal server error. Please contact support. Error ID: ${errorId}`,
      })
    );
  }
}
