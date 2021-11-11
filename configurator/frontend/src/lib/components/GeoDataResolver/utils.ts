export interface MaxMindConfig {
  enabled: boolean
  license_key: string
  editions: Edition[]
}

export interface Edition {
  main: EditionData
  analog: EditionData
}

export interface EditionData {
  name: string
  status: "ok" | "error" | "unknown"
  message: string
}
