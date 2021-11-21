export type CollectionSchedule = {
  value: string //cron expression
  label: string //display name
  id: string // id to refer
}

export const COLLECTIONS_SCHEDULES: CollectionSchedule[] = [
  { value: "@daily", label: "Once a day", id: "1d" },
  { value: "@hourly", label: "Once an hour", id: "1h" },
  { value: "*/5 * * * *", label: "5 minutes", id: "5m" },
  { value: "*/1 * * * *", label: "1 minute", id: "1m" },
]
