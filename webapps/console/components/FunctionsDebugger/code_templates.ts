export const defaultFunctionTemplate = () => {
  return `
export default async function(event, { log, fetch, props: config }) {
  log.info("Hello world")
}
`;
};
