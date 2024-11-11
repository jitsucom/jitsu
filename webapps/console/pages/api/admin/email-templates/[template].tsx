import { Api, nextJsApiHandler } from "../../../../lib/api";
import * as emailTemplates from "../../../../lib/server/templates";
import { assertDefined, assertTrue } from "juava";
import { db } from "../../../../lib/server/db";
import mjml2html from "mjml";
import { z } from "zod";
import { renderToString } from "react-dom/server";

export const api: Api = {
  POST: {
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
      const userProfile = await db.prisma().userProfile.findFirst({ where: { id: user.internalId } });
      assertDefined(userProfile, "User profile not found");
      assertTrue(userProfile.admin, "Not enough permissions");
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
