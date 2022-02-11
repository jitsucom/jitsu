/**
 * Mock for checking what various `omitFieldRule` functions will return
 */
export const mockJitsuConfigFormData = {
  _formData: {
    /**
     * checks how the Postgres `omitFieldRule` fields will work out
     */
    replication_method: {
      method: "Logical Replication (CDC)",
    },
    tunnel_method: {
      tunnel_method: "SSH_PASSWORD_AUTH",
    },
  },
}
