/**
 * This test verifies that user can't import 'fs' module.
 *
 * The test should fail
 */
const fs = require("fs");

module.exports = {
  test: () => [typeof fs],
};
