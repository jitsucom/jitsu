export const DestinationsUtils = {
  getDisplayName(dst: DestinationData) {
    return dst.displayName || dst._id
  },
}
