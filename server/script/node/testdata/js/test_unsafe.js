/**
 * This test verifies that user can't import 'fs' module.
 *
 * The test should fail
 */
const fs = require("fs");
const os = require("os")

exports.typeofs = () => [typeof fs, typeof os];
exports.call_fs = () => fs.createReadStream()
exports.call_os = () => os.arch()