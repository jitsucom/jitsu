import { Api, nextJsApiHandler, verifyAdmin } from "../../../../lib/api";
import * as emailTemplates from "../../../../lib/server/templates";
import mjml2html from "mjml";
import { z } from "zod";
import { renderToString } from "react-dom/server";

export const api: Api = {
  POST: {
    // Semantic read — renders MJML to HTML, no DB writes. Safe during maintenance.
    allowDuringMaintenance: true,
    types: {
      body: z.object({
        props: z.any(),
      }),
      query: z.object({
        template: z.any(),
      }),
    },
    auth: true,
    handle: async ({ user, body, query }) => {
      await verifyAdmin(user);
      const EmailComponent = emailTemplates[query.template];
      const str = renderToString(<EmailComponent {...(body.props || {})} />);
      const renderedEmail = await mjml2html(str, {
        validationLevel: "soft",
      });
      return {
        html: renderedEmail.html,
        allProps: renderedEmail,
      };
    },
  },
};

export default nextJsApiHandler(api);
