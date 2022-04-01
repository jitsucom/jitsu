export const isAtLeastOneStreamSelected = (source: SourceData): boolean => {
  return !!source?.["collections"]?.length || !!source.config?.selected_streams
}
