export const APIKeyUtil = {
  getDisplayName: (key: ApiKey) => {
    return key.comment || key.uid
  },
}
