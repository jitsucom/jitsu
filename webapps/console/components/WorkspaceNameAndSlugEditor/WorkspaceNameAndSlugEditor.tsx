import { useUser, useWorkspace } from "../../lib/context";
import React, { useState } from "react";
import { Input } from "antd";
import { get } from "../../lib/useApi";
import { copyTextToClipboard, feedbackError, feedbackSuccess } from "../../lib/ui";
import { publicEmailDomains } from "../../lib/shared/email-domains";
import { JitsuButton } from "../JitsuButton/JitsuButton";

function ensureLength(res): string {
  return res.length < 5 ? res + "project" : res;
}

function pickSlug(email, name): string {
  if (name) {
    //remove 's workspace from name
    name = name.replace(/'s workspace$/g, "");
    return ensureLength(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
  }
  const [username, domain] = email.split("@");
  if (!publicEmailDomains.includes(domain.toLowerCase())) {
    const [company] = domain.split(".");
    return ensureLength(company.toLowerCase());
  }
  return ensureLength(username.replace(/[^a-z0-9]/g, ""));
}

/**
 * @param onboarding if the dialog is shown on onboarding page. For onboarding,
 * we should issue an event that onboarding is completed
 */
export function WorkspaceNameAndSlugEditor({
  onSuccess,
  displayId,
  onboarding,
}: {
  onSuccess?: (newVals: { name: string; slug: string }) => void;
  displayId?: boolean;
  offerClassic?: boolean;
  onboarding?: boolean;
}) {
  const workspace = useWorkspace();
  const user = useUser();
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug || pickSlug(user.email, workspace.name));
  const [changed, setChanged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [slugError, setSlugError] = useState<string | undefined>();
  return (
    <div className="bg-backgroundLight border border-textDisabled rounded-lg overflow-hidden">
      <div className="px-6 py-4 bg-background border-b border-textDisabled">
        <h3 className="text-lg font-semibold text-textDark">Workspace Configuration</h3>
      </div>

      <div className="px-6 py-6 space-y-6">
        <div>
          <label className="block text-base font-medium text-textDark mb-2">Workspace Name</label>
          <Input
            value={name}
            size="large"
            onChange={e => {
              setName(e.target.value);
              setChanged(true);
            }}
          />
        </div>

        <div>
          <label className="block text-base font-medium text-textDark mb-2">Workspace Slug</label>
          <Input
            value={slug}
            size="large"
            onChange={e => {
              setSlug(e.target.value);
              setChanged(true);
            }}
          />
          {slugError && <div className="text-sm text-error mt-1">{slugError}</div>}
        </div>

        {displayId && (
          <div>
            <label className="block text-base font-medium text-textDark mb-2">Workspace ID</label>
            <div
              className="cursor-pointer bg-background text-textDark px-3 py-2 rounded-lg border border-textDisabled font-mono hover:bg-backgroundLight transition-colors"
              onClick={() => {
                copyTextToClipboard(workspace.id);
                feedbackSuccess("Workspace ID copied to clipboard");
              }}
            >
              {workspace.id}
            </div>
            <p className="text-xs text-text mt-1">
              You'll need this ID for making{" "}
              <a className="underline" href="https://docs.jitsu.com/api">
                API calls
              </a>
            </p>
          </div>
        )}
      </div>

      <div className="px-6 py-4 bg-background border-t border-textDisabled flex justify-end">
        <JitsuButton
          type="primary"
          loading={loading}
          requiredPermission={!onboarding ? "editEntities" : undefined}
          disabled={!changed && !onboarding}
          onClick={async () => {
            if (!slug) {
              feedbackError("Slug cannot be empty");
              return;
            }
            setLoading(true);
            try {
              if (workspace.slug !== slug) {
                const { valid, reason, suggestedSlug } = await get(`/api/workspace/slug-check`, { query: { slug } });
                if (!valid) {
                  setSlugError(reason);
                  if (suggestedSlug) {
                    setSlug(suggestedSlug);
                  }
                  return;
                }
              }
              await get(`/api/workspace/${workspace.id}?onboarding=${!!onboarding}`, {
                method: "PUT",
                body: { name, slug },
              });
              feedbackSuccess("Workspace settings have been saved");
              setChanged(false);
              if (onSuccess) {
                onSuccess({ name, slug });
              }
            } catch (e) {
              feedbackError(`Failed to save workspace settings`, { error: e });
            } finally {
              setLoading(false);
            }
          }}
        >
          Save Changes
        </JitsuButton>
      </div>
    </div>
  );
}
