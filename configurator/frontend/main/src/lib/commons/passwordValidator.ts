export const validatePassword = (rule, value, callback) => {
  if (value && value.length < 8) {
    callback("Password should be at least 8 characters")
  } else {
    callback()
  }
}
