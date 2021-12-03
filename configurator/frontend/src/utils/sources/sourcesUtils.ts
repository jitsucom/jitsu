export const isAtLeastOneStreamSelected = (source: SourceData): boolean => {
  return !!source.collections?.length || !!source.config?.catalog?.streams?.length
}
