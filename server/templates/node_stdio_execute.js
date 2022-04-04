console.log = () => {}
console.error = () => {}

send = (data) => {
  process.stdout.write(data + "\n")
}

const opts = {
  input: process.stdin,
}

require("readline").createInterface(opts).on("line", handle)
