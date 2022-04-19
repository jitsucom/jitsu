exports = () => {
  if (!globalThis.ran) {
    globalThis.ran = true;
    let arr = [];
    while (true) {
      arr.push(arr);
    }
  } else {
  }
}