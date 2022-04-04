(async () => {
  const svmq = await import("svmq")
  const MSGMAX = svmq.default.MSGMAX
  const msg = svmq.default.msg
  const rqid = msg.get(parseInt(process.argv[2]), 0o600)
  const sqid = msg.get(parseInt(process.argv[3]), 0o600)

  send = (data) => new Promise((resolve, reject) => {
    msg.snd(sqid, Buffer.from(data, "utf-8"), 1, 0, (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })

  while (true) {
    await new Promise((resolve) => {
      msg.rcv(rqid, MSGMAX, 0, 0, (error, data) => {
        if (error) {
          resolve(reply(null, `__retry: ${error}`))
        } else {
          resolve(handle(data.toString()))
        }
      })
    })
  }
})()