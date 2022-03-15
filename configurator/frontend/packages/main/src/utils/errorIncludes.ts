export const errorIncludes = (error: any, message: string): boolean => {
  return (
    `${error}`.includes(message) ||
    error?.message?.includes?.(message) ||
    error?._response?.message?.includes?.(message) ||
    error?._response?.error?.includes?.(message)
  )
}
