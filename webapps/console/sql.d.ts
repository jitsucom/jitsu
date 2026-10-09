// `.sql` files are imported as raw strings — via raw-loader in Next (see
// next.config.js) and via the raw-sql plugin in vitest (see vitest.config.ts).
declare module "*.sql" {
  const content: string;
  export default content;
}
