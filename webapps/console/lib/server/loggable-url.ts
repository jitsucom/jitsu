/**
 * A request URL that is safe to write to a log or an error message: the path
 * only, without the query string or the fragment. The query can carry a
 * credential (`__unsafe_token=…`, an invitation token, an OAuth `code`), and
 * logs are read by more people and kept longer than the request was.
 */
export function loggableUrl(url: string | undefined): string {
  if (!url) return "";
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}
