import React, { PropsWithChildren } from "react";
import DOMPurify from "dompurify";

// Descriptions and docs are short rich text: inline formatting, lists and links. The string can come from a
// workspace member (function errors) or from a connector spec shipped by a custom image, so it is never trusted
const ALLOWED_TAGS = [
  "a",
  "b",
  "i",
  "em",
  "strong",
  "u",
  "s",
  "code",
  "pre",
  "br",
  "p",
  "ul",
  "ol",
  "li",
  "span",
  "div",
];
const ALLOWED_ATTR = ["href", "class", "style", "target", "rel"];

export const sanitizeHtml = (html: string): string | undefined => {
  // Without a DOM (server render) DOMPurify returns its input untouched, so give up on markup instead
  if (!DOMPurify.isSupported) {
    return undefined;
  }
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
};

export const Htmlizer: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  if (typeof children !== "string") {
    return <>{children}</>;
  }
  const clean = sanitizeHtml(children);
  return clean === undefined ? <span>{children}</span> : <span dangerouslySetInnerHTML={{ __html: clean }} />;
};
