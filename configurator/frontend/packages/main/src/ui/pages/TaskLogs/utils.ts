export const colorMap: Record<TaskStatus, string | undefined> = {
  SCHEDULED: undefined,
  RUNNING: "processing",
  FAILED: "error",
  SUCCESS: "success",
}

export type TaskStatus = "SCHEDULED" | "RUNNING" | "FAILED" | "SUCCESS"

export interface Task {
  id: string
  source: string
  collection: string
  priority: number
  created_at: string
  finished_at: string
  started_at: string
  status: TaskStatus
}

export interface TaskLogEntry {
  time: string
  message: string
  level: "info" | "warn" | "error"
}

/**
 * Since task ID contains symbols that are not URL friendly (dot doesn't work well
 * with react-router), we need to encode/decode it before using in URL
 *
 * Note: encoding does not include URI encodling (encodeURIComponent/decodeURIComponent).
 * It should be done separately
 */
export const TaskId = {
  encode: (str: string) => {
    return str.replaceAll(".", "-dot-").replaceAll("#", "-sharp-")
  },
  decode: (id: string) => {
    return id.replaceAll("-dot-", ".").replaceAll("-sharp-", "#")
  },
}
