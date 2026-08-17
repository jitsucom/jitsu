import { getLog, LogLevel } from "juava";
import { createHash } from "crypto";
import { EventsStore, EventsLogContext } from "@jitsu/destination-functions";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import { connectToKafka, getCredentialsFromEnv } from "./kafka-config";
import { workspacesStore } from "./repositories";
import { getServerEnv } from "../serverEnv";

const log = getLog("kafka-events-store");

const serverEnv = getServerEnv();

// Live Events observability export fan-out (JITSU-138): publishes exportable
// records into the workspace's otlp destination topic plus one active_incoming
// billing record per exported envelope. Composed alongside the ClickHouse
// logger via MultiEventsStore. Fire-and-forget: export must never delay
// function execution or local Live Events writes.
//
// The envelope shape mirrors eventslog.ExportEnvelope (Go) and
// api_based.OtlpEnvelope (bulker) — keep the three in sync.

const OTLP_DESTINATION_SUFFIX = "_otlp";

// same recipe as eventslog.ExportEventId (Go): a content hash minted once at
// publish time, so delivery retries of the same envelope carry the same id and
// billing dedup collapses them. A re-emitted log record (pipeline reprocessing)
// is a new record with a new timestamp — delivered and billed again, matching
// the at-least-once semantics of the Live Events store itself
export function exportEventId(actorId: string, timestampMs: number, payload: string): string {
  return createHash("sha256")
    .update(actorId)
    .update("|")
    .update(String(timestampMs))
    .update("|")
    .update(payload)
    .digest("hex")
    .slice(0, 32);
}

// enabled = the workspaces-with-profiles export carries otlpExportEnabled for
// the workspace (set from /settings/observability-exports). The otlp topic name
// is derived from the workspace id — no connection lookup needed
function otlpExportEnabled(workspaceId: string): boolean {
  return !!workspacesStore.getCurrent()?.getObject(workspaceId)?.otlpExportEnabled;
}

type ExportRecord = {
  workspaceId: string;
  messageId?: string;
  type: string;
  level: string;
  actorId: string;
  connectionId?: string;
  body: Record<string, any>;
};

export function createKafkaEventsStore(): EventsStore {
  const prefix = serverEnv.KAFKA_TOPIC_PREFIX || "";
  // unset = billing/metrics emission disabled for this deployment, matching
  // metrics.ts — the export envelope still publishes, only billing is skipped
  const metricsDestinationId = serverEnv.METRICS_DESTINATION_ID;
  let producer: KafkaJS.Producer | undefined;
  let connecting = false;
  let closed = false;

  const ensureProducer = () => {
    if (producer || connecting || closed || !serverEnv.KAFKA_BOOTSTRAP_SERVERS) {
      return;
    }
    connecting = true;
    const kafka = connectToKafka({ defaultAppId: "rotor-otlp-export", ...getCredentialsFromEnv() });
    const p = kafka.producer({
      kafkaJS: { allowAutoTopicCreation: false, acks: 1 },
    });
    p.connect()
      .then(() => {
        if (closed) {
          // close() ran while the connect was in flight — don't leak the connection
          p.disconnect().catch(() => {});
          return;
        }
        producer = p;
        log.atInfo().log("Live-events export producer connected");
      })
      .catch(e => {
        connecting = false;
        log.atError().withCause(e).log("Failed to connect live-events export producer");
      });
  };

  // connect eagerly so the first exportable record after process start isn't
  // dropped waiting for the lazy connect (fire-and-forget still applies during
  // reconnect windows — same acceptance class as CH buffer loss on crash)
  ensureProducer();

  const publish = (record: ExportRecord) => {
    try {
      publishUnsafe(record);
    } catch (e) {
      // fire-and-forget is a hard guarantee: a serialization failure (BigInt or
      // circular values in log args) must never propagate into event processing
      log.atDebug().withCause(e).log(`Failed to build live-events export for ${record.workspaceId}`);
    }
  };

  const publishUnsafe = (record: ExportRecord) => {
    // self-export loop guard — exact match: only the workspace's own synthesized
    // otlp destination is excluded, not any actor id that ends with the suffix
    if (record.actorId === `${record.workspaceId}${OTLP_DESTINATION_SUFFIX}`) {
      return;
    }
    if (!otlpExportEnabled(record.workspaceId)) {
      return;
    }
    const otlpId = `${record.workspaceId}${OTLP_DESTINATION_SUFFIX}`;
    ensureProducer();
    if (!producer) {
      return;
    }
    const timestampMs = Date.now();
    const body = record.body ?? {};
    const eventId = exportEventId(record.actorId, timestampMs, JSON.stringify(body));
    const envelope = {
      eventId,
      workspaceId: record.workspaceId,
      ...(record.messageId ? { messageId: record.messageId } : {}),
      type: record.type,
      level: record.level,
      timestamp: timestampMs,
      actorId: record.actorId,
      ...(record.connectionId ? { connectionId: record.connectionId } : {}),
      body,
    };
    const exportTopic = `${prefix}in.id.${otlpId}.m.batch.t.live_events`;
    const p = producer;
    p.send({ topic: exportTopic, messages: [{ key: record.workspaceId, value: JSON.stringify(envelope) }] })
      .then(() => {
        // billing only after the export record was acked into Kafka — a record
        // that never left the process must not be billed.
        // key {eventId}_0_{secondsWithinHour}, hour-truncated timestamp —
        // ClickHouse uniqState(messageId) dedups retries downstream
        if (!metricsDestinationId) {
          return;
        }
        const hourMs = Math.floor(timestampMs / 3600000) * 3600000;
        const secondsWithinHour = Math.floor((timestampMs - hourMs) / 1000);
        const billingKey = `${eventId}_0_${secondsWithinHour}`;
        const billingTopic = `${prefix}in.id.${metricsDestinationId}.m.batch.t.active_incoming`;
        p.send({
          topic: billingTopic,
          messages: [
            {
              key: billingKey,
              value: JSON.stringify({
                timestamp: new Date(hourMs).toISOString(),
                workspaceId: record.workspaceId,
                messageId: billingKey,
              }),
            },
          ],
        }).catch(e => log.atDebug().withCause(e).log(`Failed to publish export billing for ${record.workspaceId}`));
      })
      .catch(e => log.atDebug().withCause(e).log(`Failed to publish live-events export for ${record.workspaceId}`));
  };

  return {
    log(connectionId: string, level: LogLevel, msg: Record<string, any>, opts?: EventsLogContext): void {
      if (!opts?.workspaceId) {
        return;
      }
      publish({
        workspaceId: opts.workspaceId,
        messageId: opts.messageId,
        type: "function",
        level,
        actorId: connectionId,
        connectionId,
        body: msg,
      });
    },
    deadLetter(workspaceId: string, connectionId: string, type: string, payload: any, error: any, messageId?: string) {
      if (!workspaceId) {
        return;
      }
      publish({
        workspaceId,
        messageId,
        type: "dead-letter",
        level: "error",
        actorId: connectionId,
        connectionId,
        body: { payload, error },
      });
    },
    close() {
      closed = true;
      if (producer) {
        producer.disconnect().catch(() => {});
      }
    },
  };
}
