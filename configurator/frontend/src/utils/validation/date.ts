import { DATE_REGEX } from '@./constants/regex';

const isValidFullIsoDate = (date: string) => DATE_REGEX.ISO_FULL.test(date);
const isValidShortIsoDate = (date: string) => DATE_REGEX.ISO_SHORT.test(date);
const IsValidIsoDate = (date: string) => isValidFullIsoDate(date) || isValidShortIsoDate(date);

export { isValidFullIsoDate, isValidShortIsoDate, IsValidIsoDate }
