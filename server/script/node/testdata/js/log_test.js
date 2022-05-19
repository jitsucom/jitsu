exports.log = () => {
  let obj = {a: 1, b: [2]}
  console.log("test", obj)
}

exports.log_recursive = () => {
  let obj = {a: 1}
  obj.obj = obj
  console.error("test", obj)
}