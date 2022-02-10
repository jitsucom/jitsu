import { isUrlValid } from "utils/validation/url"

const dsnValidator = (value: string) => {
  if (!value) {
    return "Value can't be empty"
  }
  if (!isUrlValid(value)) {
    return "URL is not valid should be [tcp|http(s)]://host[:port]?params"
  }
  return null
}

export interface ValidationRulesProps {
  required?: boolean
  displayName
}

export { dsnValidator }
