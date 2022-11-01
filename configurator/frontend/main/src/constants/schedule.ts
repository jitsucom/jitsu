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

let dailyHours: CollectionSchedule[] = []
for (let i = 0; i < 24; i++) {
  dailyHours.push({
    value: i.toString(),
    label: i < 10 ? `0${i}:00` : `${i}:00`,
    id: i.toString(),
  })
}

export const DAILY_HOURS = dailyHours
