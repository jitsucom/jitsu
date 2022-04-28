import { DATE_REGEX } from "constants/regex"

const isValidFullIsoDate = (date: string) => DATE_REGEX.ISO_FULL.test(date)
const isValidFullWoMsIsoDate = (date: string) => DATE_REGEX.ISO_FULL_WO_MS.test(date)
const isValidShortIsoDate = (date: string) => DATE_REGEX.ISO_SHORT.test(date)
const IsValidIsoDate = (date: string) =>
  isValidFullIsoDate(date) || isValidFullWoMsIsoDate(date) || isValidShortIsoDate(date)

export { isValidFullIsoDate, isValidFullWoMsIsoDate, isValidShortIsoDate, IsValidIsoDate }
