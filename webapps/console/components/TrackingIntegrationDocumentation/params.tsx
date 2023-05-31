import { branding } from "../../lib/branding";

export const jsConfigParams = [
  {
    name: "userId",
    apply: undefined,
    description: (
      <>
        Set's user id. Equivalent of calling <code>{branding.productName.toLowerCase()}.identify(userId)</code>
      </>
    ),
  },
  {
    name: "onload",
    apply: ["html"],
    description: (
      <>
        Function to call after the script has loaded. Function should be previously defined in <code>window</code>
      </>
    ),
  },
  {
    name: "initOnly",
    apply: ["html"],
    description: (
      <>
        By default, the script will send a <code>page</code> event. Set this to <code>true</code> to just initialize the
        library. You still will be able to send events manually by setting <code>data-onload</code> hook
      </>
    ),
  },
  {
    name: "writeKey",
    apply: ["html"],
    description: (
      <>
        Public Write Key configured on Jitsu Site entity. Required when Site doesn't have explicitly mapped domain or
        multiple Sites configured for a single domain. If not Public Write Key is added for Site entity, Site ID value
        can be used a Write Key
      </>
    ),
  },
] as const;
