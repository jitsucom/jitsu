import { SessionUser } from "../schema";
import { ApiError } from "../shared/errors";

/**
 * "Become user" mints a login for any account, so it is limited to an interactive Firebase session.
 * API keys (authType "bearer"), MCP tokens and service accounts are rejected: they are long-lived,
 * can be passed in a URL, and are not tied to an admin sitting at the console.
 */
export function assertInteractiveAdminSession(user: Pick<SessionUser, "authType">): void {
  if (user.authType !== "firebase") {
    throw new ApiError("Becoming another user is only allowed from an interactive admin session", { status: 403 });
  }
}
