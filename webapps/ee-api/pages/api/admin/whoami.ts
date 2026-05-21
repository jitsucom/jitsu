import { withFirebaseAdminAuth } from "../../../lib/route-helpers";

/**
 * Returns the signed-in admin. The client calls this after Firebase sign-in to
 * decide whether to show the admin UI — `withFirebaseAdminAuth` does the real
 * authorization (verified Google account on the JITSU_EE_ADMINS allow-list).
 */
export default withFirebaseAdminAuth(async (req, res, admin) => {
  return { email: admin.email };
});
