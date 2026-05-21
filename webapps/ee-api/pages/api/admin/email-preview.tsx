import React from "react";
import { render } from "@react-email/components";
import { withFirebaseAdminAuth } from "../../../lib/route-helpers";
import { emailTemplates, getComponent } from "../../../lib/email";

/**
 * Renders an email template to HTML using its default preview values, for the
 * admin Email page preview pane. Requires `?template=`.
 */
export default withFirebaseAdminAuth(async (req, res) => {
  const template = req.query.template;
  if (typeof template !== "string" || !template) {
    res.status(400).json({ error: "template query param is required" });
    return;
  }
  if (!(emailTemplates as readonly string[]).includes(template)) {
    res.status(400).json({ error: `Unknown template: ${template}` });
    return;
  }
  const Component = getComponent(template);
  const previewProps = Component.defaultValues ?? {};
  const rawHtml = await render(<Component {...previewProps} />);
  // Email bodies render flush to the edge; add gutters so the preview is readable.
  const previewStyle = "<style>body{padding:24px 32px;}</style>";
  const html = rawHtml.includes("</head>")
    ? rawHtml.replace("</head>", `${previewStyle}</head>`)
    : previewStyle + rawHtml;
  const subject = typeof Component.subject === "function" ? Component.subject(previewProps) : Component.subject;
  return { html, subject, from: Component.from ?? null };
});
