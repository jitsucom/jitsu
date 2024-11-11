export const defaultFunctionTemplate = () => {
  return `export default async function(event, { log, fetch }) {
  log.info("Hello world")
}`;
};
