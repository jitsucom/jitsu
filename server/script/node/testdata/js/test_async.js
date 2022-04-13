/**
 * The test verifies that executor can handle async function;
 * if function returns Promise, executor should wait until the result is
 * available
 */

async function test() {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, 1000);
  });
}

exports.test = test;
