import React, { useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { Button } from "antd";
import type { GetServerSideProps } from "next";
import { useUser } from "../../lib/context";
import { db } from "../../lib/server/db";

// MCP OAuth consent page. Renders after the user is logged in (LoginWrapper
// in _app.tsx handles the redirect-to-/signin dance if not). On Approve we
// POST to /api/mcp/oauth/approve which mints a one-shot code and returns
// the URL we should bounce the browser to.
const Authorize = ({ clientName }: { clientName: string | null }) => {
  const router = useRouter();
  const user = useUser();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const q = router.query;
  const clientId = typeof q.client_id === "string" ? q.client_id : undefined;
  const redirectUri = typeof q.redirect_uri === "string" ? q.redirect_uri : undefined;
  const codeChallenge = typeof q.code_challenge === "string" ? q.code_challenge : undefined;
  const codeChallengeMethod = typeof q.code_challenge_method === "string" ? q.code_challenge_method : undefined;
  const responseType = typeof q.response_type === "string" ? q.response_type : undefined;
  const state = typeof q.state === "string" ? q.state : undefined;

  const valid = clientId && redirectUri && codeChallenge && codeChallengeMethod === "S256" && responseType === "code";

  if (!router.isReady) return null;

  if (!valid) {
    return (
      <Wrap>
        <h1 className="text-lg mb-3">Invalid authorization request</h1>
        <div className="text-textLight">
          Missing or unsupported parameters. This page is meant to be opened by an MCP client (e.g. Claude Desktop) — it
          shouldn't be visited directly.
        </div>
      </Wrap>
    );
  }

  const approve = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      const res = await fetch("/api/mcp/oauth/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod,
          response_type: responseType,
          state,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error_description ?? body.error ?? "Failed to authorize");
        setSubmitting(false);
        return;
      }
      // Bounce the browser to the MCP client's redirect URI with ?code=...
      window.location.href = body.redirect_to;
    } catch (e: any) {
      setError(e.message ?? "Network error");
      setSubmitting(false);
    }
  };

  // Deny goes through the server so the redirect URI is validated against the
  // OAuthClient's registered whitelist (and scheme-checked). Building the URL
  // client-side from query params would be an open-redirect — anything in
  // ?redirect_uri= would be navigated to.
  const deny = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      const res = await fetch("/api/mcp/oauth/deny", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, redirect_uri: redirectUri, state }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error_description ?? body.error ?? "Failed to cancel");
        setSubmitting(false);
        return;
      }
      window.location.href = body.redirect_to;
    } catch (e: any) {
      setError(e.message ?? "Network error");
      setSubmitting(false);
    }
  };

  return (
    <Wrap>
      <h1 className="text-lg mb-3">Authorize MCP client</h1>
      <div className="mb-4">
        <div className="text-textLight text-sm">Client</div>
        <div className="font-mono text-sm break-all">{clientName ?? clientId}</div>
      </div>
      <div className="mb-4">
        <div className="text-textLight text-sm">Redirect URI</div>
        <div className="font-mono text-xs break-all">{redirectUri}</div>
      </div>
      <div className="mb-4">
        <div className="text-textLight text-sm">Account</div>
        <div className="text-sm">{user.email}</div>
      </div>
      <div className="text-sm text-textLight mb-6">
        This client will be able to access your Jitsu account via the API on your behalf. You can revoke access at any
        time from{" "}
        <Link className="text-primary underline" href="/user">
          your user settings
        </Link>
        .
      </div>
      {error && <div className="text-red-500 text-sm mb-4 border border-red-200 rounded px-2.5 py-1.5">{error}</div>}
      <div className="flex gap-2 justify-end">
        <Button onClick={deny} disabled={submitting}>
          Deny
        </Button>
        <Button type="primary" onClick={approve} loading={submitting}>
          Approve
        </Button>
      </div>
    </Wrap>
  );
};

export const getServerSideProps: GetServerSideProps = async ({ query }) => {
  const clientId = typeof query.client_id === "string" ? query.client_id : null;
  if (!clientId) return { props: { clientName: null } };
  const client = await db.prisma().oAuthClient.findUnique({ where: { id: clientId }, select: { name: true } });
  return { props: { clientName: client?.name ?? null } };
};

const Wrap: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div className="flex justify-center">
    <div className="px-4 py-6 flex flex-col items-center w-full" style={{ maxWidth: "560px" }}>
      <div className="w-full px-8 py-6 border border-textDisabled rounded-lg">{children}</div>
    </div>
  </div>
);

export default Authorize;
