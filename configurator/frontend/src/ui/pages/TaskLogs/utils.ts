export const colorMap: Record<TaskStatus, string | undefined> = {
  SCHEDULED: undefined,
  RUNNING: 'processing',
  FAILED: 'error',
  SUCCESS: 'success'
}

export type TaskStatus = 'SCHEDULED' | 'RUNNING' | 'FAILED' | 'SUCCESS';

export interface Task {
  id: string
  source: string
  collection: string
  priority: number
  created_at: string
  started_at: string
  status: TaskStatus
}

export interface TaskLogEntry {
  time: string,
  message: string,
  level: 'info' | 'warn' | 'error'
}