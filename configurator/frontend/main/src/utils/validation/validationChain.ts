const validationChain = (...args) => args.filter(validator => typeof validator === "object")

export { validationChain }
