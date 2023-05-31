import { useRouter } from "next/router";

export function useQueryStringCopy(): "" | `?${string}` {
  const router = useRouter();
  if (Object.entries(router.query).length === 0) {
    return "";
  }
  //arrays are not supported yet
  return `?${Object.entries(router.query)
    .map(([key, value]) => `${key}=${encodeURIComponent(value as string)}`)
    .join("&")}`;
}
