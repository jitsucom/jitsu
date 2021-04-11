/**
 * File exports different functions. In this case
 * the function name should be set explicitely
 */

module.exports = {
  transform1: function(event) {
    return ["test", {...event, add: 2}]
  },
  transform2: function(event) {
    return ["", {...event, add: 1}] //event should be discarded since table name is an empty string
  }
}