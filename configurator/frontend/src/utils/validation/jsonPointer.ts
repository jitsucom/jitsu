const isValidJsonPointer = (val: string = "") =>
  val.length > 0 && val[0] === "/" && val[val.length - 1] !== "/" && val.indexOf(" ") < 0

export { isValidJsonPointer }
