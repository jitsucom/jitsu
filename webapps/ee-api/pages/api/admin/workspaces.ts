import { withFirebaseAdminAuth } from "../../../lib/route-helpers";
import { listWorkspaces } from "../../../lib/workspaces";

/** All workspaces, for the admin Email page workspace selector. */
export default withFirebaseAdminAuth(async () => {
  return { workspaces: await listWorkspaces() };
});
