import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useWorkspace } from "../../../lib/context";
import { requireDefined, rpc } from "juava";
import { useConfigObjectLinks, useConfigObjectList } from "../../../lib/store";
import { Button } from "antd";
import { LoadingAnimation } from "../../../components/GlobalLoader/GlobalLoader";
import { CodeEditor } from "../../../components/CodeEditor/CodeEditor";
import { SimpleErrorCard } from "../../../components/GlobalError/GlobalError";
import { ConnectionTitle } from "../connections";
import { feedbackError } from "../../../lib/ui";
import { BackButton } from "../../../components/BackButton/BackButton";

function StateEditor() {
  const router = useRouter();
  const links = useConfigObjectLinks({ withData: true });
  const workspace = useWorkspace();

  const existingLink = requireDefined(
    router.query.id ? links.find(link => link.id === router.query.id) : undefined,
    `Sync with id ${router.query.id} not found`
  );
  const service = requireDefined(
    useConfigObjectList("service").find(s => s.id === existingLink.fromId),
    "Service not found"
  );
  const destination = requireDefined(
    useConfigObjectList("destination").find(d => d.id === existingLink.toId),
    "Destination not found"
  );

  const syncOptions = existingLink?.data;

  const [catalog, setCatalog] = useState<any>(undefined);
  const [state, setState] = useState<Record<string, string>>({});
  const [editedState, setEditedState] = useState<Record<string, string>>({});
  const [stateShown, setStateShown] = useState<Record<string, boolean>>({});
  const [stateSaving, setStateSaving] = useState<Record<string, boolean>>({});
  const [catalogError, setCatalogError] = useState<any>(undefined);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingState, setLoadingState] = useState(true);

  const [refreshCatalog, setRefreshCatalog] = useState(0);

  const saveState = useCallback(
    async (stream: string, state: any) => {
      setStateSaving({ ...stateSaving, [stream]: true });
      try {
        const res = await rpc(
          `/api/${workspace.id}/sources/state?syncId=${router.query.id}&stream=${encodeURIComponent(stream)}`,
          {
            method: "POST",
            body: state ? JSON.parse(state) : {},
          }
        );
        if (res.ok) {
          setState(res.state);
          setEditedState({});
        } else {
          feedbackError(res.error, { placement: "top" });
          return false;
        }
        return true;
      } catch (error) {
        feedbackError("Failed to save state", { error, placement: "top" });
        return false;
      } finally {
        setStateSaving({ ...stateSaving, [stream]: false });
      }
    },
    [router.query.id, stateSaving, workspace.id]
  );

  useEffect(() => {
    (async () => {
      try {
        setLoadingState(true);
        const state = await rpc(`/api/${workspace.id}/sources/state?syncId=${router.query.id}`);
        if (state.ok) {
          setState(state.state);
          setEditedState({});
        } else {
          feedbackError("Failed to load state: " + state.error, { placement: "top" });
        }
      } catch (error: any) {
        feedbackError("Failed to load state: " + error.message, { placement: "top" });
      } finally {
        setLoadingState(false);
      }
    })();
  }, [router.query.id, workspace.id]);

  useEffect(() => {
    if (catalog) {
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingCatalog(true);
      try {
        const force = refreshCatalog > 0;
        const firstRes = await rpc(
          `/api/${workspace.id}/sources/discover?serviceId=${existingLink.fromId}${force ? "&refresh=true" : ""}`
        );
        if (cancelled) {
          return;
        }
        if (typeof firstRes.error !== "undefined") {
          setCatalogError(firstRes.error);
        } else if (firstRes.ok) {
          setCatalog(firstRes.catalog);
        } else {
          for (let i = 0; i < 600; i++) {
            if (cancelled) {
              return;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
            const resp = await rpc(`/api/${workspace.id}/sources/discover?serviceId=${existingLink.fromId}`);
            if (!resp.pending) {
              if (typeof resp.error !== "undefined") {
                setCatalogError(resp.error);
                return;
              } else {
                setCatalog(resp.catalog);
                return;
              }
            }
          }
          setCatalogError(`Cannot load catalog for ${existingLink.fromId} error: Timeout`);
        }
      } catch (error) {
        setCatalogError(error);
      } finally {
        if (!cancelled) {
          setLoadingCatalog(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace.id, existingLink.fromId, refreshCatalog, catalog]);

  return (
    <div className="max-w-5xl grow">
      <div className="flex justify-between pb-0 mb-0 items-start">
        <ConnectionTitle connectionId={existingLink.id} destination={destination} service={service} showLink={false} />
        <BackButton useHistory={true} href={`/${workspace.slugOrId}/syncs/edit?id=${existingLink.id}`} />
      </div>
      <div className="w-full">
        <div className="flex flex-row items-center justify-between gap-2 mt-4 mb-3">
          <div className={"text-lg"}>Saved states</div>
        </div>
        <div className={`w-full h-full flex flex-col border rounded`}>
          {loadingCatalog || loadingState ? (
            <LoadingAnimation
              className={"h-96"}
              title={"Loading connector catalog..."}
              longLoadingThresholdSeconds={4}
              longLoadingTitle={"It may take a little longer if it happens for the first time or catalog is too big."}
            />
          ) : catalog ? (
            (catalog.streams ?? []).map(stream => {
              const name = stream.namespace ? `${stream.namespace}.${stream.name}` : stream.name;
              const stateCode = (
                <div
                  className={`w-full font-mono whitespace-pre-wrap break-all p-1.5 pt-2 text-xs text-textLight`}
                  style={{ overflow: "scroll", lineHeight: "1.5", maxHeight: "220px" }}
                >
                  {state[name] ?? "{}"}
                </div>
              );
              return (
                <div key={name} className={"flex flex-row gap-3 border-collapse border-b border-textDisabled p-3"}>
                  <div className={"w-60 flex-shrink-0 h-full overflow-hidden text-ellipsis text flex flex-col gap-2"}>
                    <div className={""}>{stream.name}</div>

                    <div className={"grid grid-cols-3 auto-cols-auto gap-2 gap-x-3 py-2 text-xs text-textLight"}>
                      {stream.namespace && (
                        <>
                          <div>Namespace:</div>
                          <div className={"col-span-2"}>{stream.namespace}</div>
                        </>
                      )}
                      <div>Mode:</div>
                      <div className={"col-span-2"}>{syncOptions?.streams?.[name]?.sync_mode ?? "disabled"}</div>

                      {stream.supported_sync_modes.includes("incremental") &&
                        syncOptions?.streams?.[name]?.sync_mode === "incremental" &&
                        !stream.source_defined_cursor && (
                          <>
                            <div>Cursor&nbsp;field:</div>
                            <div className={"col-span-2"}>
                              {!stream.source_defined_cursor
                                ? syncOptions?.streams?.[name]?.cursor_field?.[0]
                                : undefined}
                            </div>
                          </>
                        )}
                    </div>
                  </div>
                  <div className={"flex flex-auto flex-row w-full"}>
                    {stateShown[name] ? (
                      <div
                        className={"flex-auto max-h-2xs border border-textDisabled w-full rounded"}
                        style={{ maxHeight: "220px" }}
                      >
                        <CodeEditor
                          value={editedState[name] || state[name] || "{}"}
                          language={"json"}
                          onChange={st => {
                            setEditedState({ ...editedState, [name]: st });
                          }}
                          autoFit
                          loaderNode={stateCode}
                          monacoOptions={{
                            automaticLayout: true,
                            lineNumbers: "off",
                            glyphMargin: false,
                            folding: false,
                            lineDecorationsWidth: 6,
                            lineNumbersMinChars: 0,
                            guides: {
                              indentation: false,
                            },
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        className={"flex-auto max-h-2xs border overflow-scroll border-textDisabled rounded"}
                        style={{ maxHeight: "220px" }}
                        onClick={() => {
                          setEditedState({ ...editedState, [name]: state[name] });
                          setStateShown({ [name]: !stateShown[name] });
                        }}
                      >
                        {stateCode}
                      </div>
                    )}
                  </div>
                  <div className={"flex flex-col justify-between gap-2"}>
                    <Button
                      style={{ width: 82 }}
                      //ghost={!stateShown[name]}
                      size={"small"}
                      type={stateShown[name] ? "default" : "default"}
                      onClick={() => {
                        setEditedState({ ...editedState, [name]: state[name] });
                        setStateShown({ [name]: !stateShown[name] });
                      }}
                    >
                      {stateShown[name] ? "Cancel" : "Edit"}
                    </Button>
                    {stateShown[name] && (
                      <Button
                        style={{ width: 82 }}
                        loading={stateSaving[name]}
                        type={"primary"}
                        disabled={editedState[name] === state[name]}
                        ghost
                        size={"small"}
                        onClick={async () => {
                          const saved = await saveState(name, editedState[name]);
                          if (saved) {
                            setStateShown({ [name]: !stateShown[name] });
                          }
                        }}
                      >
                        Save
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <SimpleErrorCard
              title={"Failed to load catalog"}
              error={{ message: catalogError || "Unknown error. Please contact support." }}
            />
          )}
        </div>
      </div>
      <div className="flex justify-end pt-6">
        <div className="flex justify-end space-x-5 items-center">
          <Button type="primary" ghost size="large" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

const StorePage = () => {
  return (
    <WorkspacePageLayout>
      <div className="flex justify-center">
        <StateEditor />
      </div>
    </WorkspacePageLayout>
  );
};

export default StorePage;
