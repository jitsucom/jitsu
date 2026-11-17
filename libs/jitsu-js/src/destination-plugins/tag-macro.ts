// JSON that is safe to put into HTML: the event carries page-controlled values (utm params, referrer, title),
// so `</script>` or `<img onerror=...>` inside it must not break out of the surrounding markup
export function jsonForHtml(value: any): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    ch => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0")
  );
}

export function replaceMacro(code: string, event: any): string {
  const json = jsonForHtml(event);
  // function replacement: a string would interpret `$&`, `$1` etc. coming from the event
  return code.replace(/{{\s*event\s*}}/g, () => json);
}
