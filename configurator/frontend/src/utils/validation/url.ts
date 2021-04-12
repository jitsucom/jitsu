const isUrlValid = (value: string) => value
  .match(/((http(s)?|tcp):\/\/.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/g);

export { isUrlValid };
