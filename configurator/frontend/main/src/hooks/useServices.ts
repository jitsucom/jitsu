import { useMemo } from "react"
import ApplicationServices from "../lib/services/ApplicationServices"

export function useServices(): ApplicationServices {
  return useMemo<ApplicationServices>(() => ApplicationServices.get(), [])
}
