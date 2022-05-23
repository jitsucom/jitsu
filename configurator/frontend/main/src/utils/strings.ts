/**
 * Object of options for the `toTitleCase` function
 */
type ToTitleCaseOptions = {
  /**
   * Object with specific rules that override the default title case 'word' -> 'Word' mapping
   */
  rules?: Rules
  /**
   * Flag that controls whether to apply the default mapping rules
   */
  useDefaultRules?: boolean
  /**
   * Specify a separator such as '_' for the snake case. Default separator is whitespace.
   */
  separator?: string
}

type Rules = { [key: string]: string }

const toTitleCaseDefaultOptions: ToTitleCaseOptions = {
  rules: {
    js: "JS",
    ts: "TS",
    id: "ID",
    db: "DB",
    api: "API",
    url: "URL",
    ssl: "SSL",
    ssh: "SSH",
    tls: "TLS",
    mysql: "MySQL",
    mongodb: "MongoDB",
    googleads: "GoogleAds",
    jdbc: "JDBC",
  },
  useDefaultRules: true,
}

const { rules, ...toTitleCaseDefaultOptionsWithoutRules }: ToTitleCaseOptions = toTitleCaseDefaultOptions

/**
 * Maps the string to the title case. Uses a default abbreviations dictionary
 * to uppercase them. You may override the default abbreviation dictionary by
 * passing your own, or you can disable abbreviations uppercasing at all by
 * setting the corresponding flag.
 * @param value a string to map to the title case
 * @param rulesDict
 * An object which keys are lovercased strings and which values are
 * the correctly uppercased strings. To omit this argument just
 * set it to any falsy value.
 *
 * The Function uses a default dictionary of rules. You can extend it
 * by passing your own dictionary or you can disable it completely by setting
 * `useDefaultRules: true` in the options argument.
 * @param options options object that configures the mapping.
 * @example
 * ```
 * const myOwnRules = {
 *  js: 'JSX', // will override the default 'JS' rule
 *  nhtca: 'NHTCA', // will extend the default rules
 * }
 *
 * toTitleCase('uSe of js is prohIbitEd by nhtca', {rules})
 * // 'Use Of JSX Is Prohibited By NHTCA'
 * ```
 */
export const toTitleCase = (value: string, options?: ToTitleCaseOptions): string => {
  if (!value) {
    return ""
  }

  const { rules } = options
    ? options.useDefaultRules === false
      ? { ...toTitleCaseDefaultOptionsWithoutRules, ...options }
      : { ...toTitleCaseDefaultOptions, ...options }
    : toTitleCaseDefaultOptions
  return value
    .split(options?.separator ?? " ")
    .map(_word => {
      const word = _word.toLowerCase()
      const mappedByRule = rules[word]
      return mappedByRule || `${word[0].toUpperCase()}${word.slice(1)}`
    })
    .join(" ")
}

/**
 * Maps a `snake_case` string to a `regular case` string
 * @param value string to convert
 */
export const snakeCaseToWords = (value: string): string => {
  return value.split("_").join(" ")
}
