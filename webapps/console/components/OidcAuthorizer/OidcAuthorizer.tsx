import React, { PropsWithChildren, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getLog } from "juava";
import { ContextApiResponse } from "../../lib/schema";
import { UserContextProvider } from "../../lib/context";
import { GlobalLoader } from "../GlobalLoader/GlobalLoader";
import { GlobalError } from "../GlobalError/GlobalError";

const log = getLog("oidc-authorizer");

export const OidcAuthorizer: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  const [user, setUser] = useState<ContextApiResponse["user"] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<any>(undefined);
  const router = useRouter();

  useEffect(() => {
    const getCookie = (name: string): string | null => {
      const cookies = document.cookie.split(";").reduce((acc, cookie) => {
        const [key, value] = cookie.trim().split("=");
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>);
      return cookies[name] || null;
    };

    const checkAndRenewSession = () => {
      const oidcSessionToken = getCookie("oidc-session");
      if (oidcSessionToken) {
        try {
          // Decode the OIDC session token (no verification needed on frontend)
          const base64Payload = oidcSessionToken.split(".")[1];
          const payload = JSON.parse(atob(base64Payload));

          // Check if token is close to expiring (within 1 hour)
          const tokenExp = payload.exp * 1000; // Convert to milliseconds
          const now = Date.now();
          const timeUntilExpiry = tokenExp - now;
          const oneHour = 60 * 60 * 1000;

          if (timeUntilExpiry < oneHour && timeUntilExpiry > 0) {
            // Token is close to expiring, try to renew it
            fetch("/api/auth/renew-oidc", {
              method: "POST",
              credentials: "include",
            }).catch(error => {
              log.atWarn().withCause(error).log("Failed to renew OIDC session");
            });
          }

          // Convert OIDC session to user format
          const oidcUser: ContextApiResponse["user"] = {
            email: payload.email,
            externalId: payload.externalId,
            externalUsername: payload.email,
            image: null,
            internalId: payload.userId,
            loginProvider: payload.loginProvider,
            name: payload.name,
          };

          log.atInfo().log("OIDC user authenticated", { email: oidcUser.email, provider: oidcUser.loginProvider });

          setUser(oidcUser);
          setLoading(false);
          return true; // OIDC session handled
        } catch (error) {
          log.atError().withCause(error).log("Error processing OIDC session");
          setAuthError(error);
          setLoading(false);
          return false;
        }
      }

      // No OIDC session found
      setLoading(false);
      return false;
    };

    // Initial check
    checkAndRenewSession();

    // Set up periodic renewal check (every 30 minutes)
    const renewalInterval = setInterval(checkAndRenewSession, 30 * 60 * 1000);

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
  } else if (authError) {
    return <GlobalError error={authError} title={"Authorization error"} />;
  } else if (user) {
    return (
      <UserContextProvider
        user={user}
        logout={async () => {
          setUser(null);
          // Clear the OIDC session cookie
          document.cookie = "oidc-session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        }}
      >
        {children}
      </UserContextProvider>
    );
  }
  // If loading or no user, return children without user context
  // This allows the parent component to handle the auth state
  return children;
};
