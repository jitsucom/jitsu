export const APIKeyUtil = {
  getDisplayName: (key: APIKey) => {
    return key.comment || key.uid
  },
}
