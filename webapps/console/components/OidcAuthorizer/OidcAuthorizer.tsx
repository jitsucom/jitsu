import React, { PropsWithChildren, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getLog } from "juava";
import { ContextApiResponse } from "../../lib/schema";
import { UserContextProvider } from "../../lib/context";
import { GlobalLoader } from "../GlobalLoader/GlobalLoader";

const log = getLog("oidc-authorizer");

export const OidcAuthorizer: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  const [user, setUser] = useState<ContextApiResponse["user"] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const router = useRouter();

  useEffect(() => {
    const checkAndRenewSession = async () => {
      try {
        // Check session via secure API endpoint
        const response = await fetch("/api/auth/dynamic-oidc/session", {
          method: "GET",
          credentials: "include",
        });

        if (!response.ok) {
          return false;
        }

        const data = await response.json();

        if (data.authenticated && data.user) {
          // Convert to user format
          const oidcUser: ContextApiResponse["user"] = {
            email: data.user.email,
            externalId: data.user.externalId,
            externalUsername: data.user.email,
            image: null,
            internalId: data.user.internalId,
            loginProvider: data.user.loginProvider,
            name: data.user.name,
          };

          log.atInfo().log("OIDC user authenticated", { email: oidcUser.email, provider: oidcUser.loginProvider });
          setUser(oidcUser);
          return true;
        } else if (data.needsRefresh) {
          // Token needs refresh, try to renew the session
          log.atInfo().log("OIDC session needs refresh, attempting renewal");

          const renewResponse = await fetch("/api/auth/dynamic-oidc/renew", {
            method: "POST",
            credentials: "include",
          });

          if (renewResponse.ok) {
            // After successful renewal, check session again
            const secondCheckResponse = await fetch("/api/auth/dynamic-oidc/session", {
              method: "GET",
              credentials: "include",
            });

            if (secondCheckResponse.ok) {
              const secondData = await secondCheckResponse.json();

              if (secondData.authenticated && secondData.user) {
                const oidcUser: ContextApiResponse["user"] = {
                  email: secondData.user.email,
                  externalId: secondData.user.externalId,
                  externalUsername: secondData.user.email,
                  image: null,
                  internalId: secondData.user.internalId,
                  loginProvider: secondData.user.loginProvider,
                  name: secondData.user.name,
                };

                log.atInfo().log("OIDC session successfully refreshed", { email: oidcUser.email });
                setUser(oidcUser);
                return true;
              }
            }
          }

          log.atWarn().log("Failed to refresh OIDC session, user needs to re-authenticate");
          return false;
        } else {
          log.atWarn().log("OIDC session not authenticated");
        }
      } catch (error) {
        log.atError().withCause(error).log("Error checking OIDC session");
      } finally {
        setLoading(false);
      }
      return false;
    };

    // Initial check
    const okPromis = checkAndRenewSession();

    // Set up periodic renewal check (every 30 minutes)
    const renewalInterval = setInterval(async () => {
      let ok = await okPromis;
      if (!ok) {
        // we don't have a user, so we don't need to renew
        clearInterval(renewalInterval);
        return;
      }
      ok = await checkAndRenewSession();
      if (!ok) {
        log.atWarn().log("OIDC session renewal failed");
        // renew may be failed do to network issues or server errors, so we don't clear user here
        // oidc-session cookie will die after 24 hours anyway
      }
    }, 30 * 60 * 1000);

    return () => clearInterval(renewalInterval);
  }, []);

  useEffect(() => {
    if (router.query.projectName) {
      localStorage.setItem("projectName", router.query.projectName as string);
    }
  }, [router.query.projectName]);

  // If we have a user, provide the context
  if (loading) {
    return <GlobalLoader title={"Authorizing"} />;
  } else if (user) {
    return (
      <UserContextProvider
        user={user}
        logout={async () => {
          // Call logout endpoint to clear httpOnly cookie
          try {
            await fetch("/api/auth/dynamic-oidc/logout", {
              method: "POST",
              credentials: "include",
            });
            setUser(null);
            router.push("/signin");
          } catch (error) {
            log.atError().withCause(error).log("Error during OIDC logout");
          }
        }}
      >
        {children}
      </UserContextProvider>
    );
  }
  // If loading or no user, return children without user context
  // This allows the next component to handle the auth state
  return children;
};
