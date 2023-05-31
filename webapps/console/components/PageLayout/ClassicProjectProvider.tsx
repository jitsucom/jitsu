import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";
import { getLog, requireDefined } from "juava";
import { ClassicProjectStatus, getEeClient } from "../../lib/ee-client";
import { useAppConfig, useWorkspace } from "../../lib/context";

const log = getLog(`ClassicProjectProvider`);

const defaultStatus = {
  active: false,
  ok: true,
  project: null,
  uid: null,
  name: null,
};

export const ClassicProjectContext = createContext<ClassicProjectStatus>(defaultStatus);

export function useClassicProject(): ClassicProjectStatus {
  const ctx = useContext(ClassicProjectContext);
  if (!ctx) {
    throw new Error(`useClassicProject() must be used inside <ClassicProjectProvider />`);
  }
  return ctx;
}

export const ClassicProjectProvider: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  const appConfig = useAppConfig();
  const [classicProject, setClassicProject] = useState<ClassicProjectStatus>(defaultStatus);
  const currentWorkspace = useWorkspace();
  const eeClient = useMemo(
    () =>
      appConfig.ee.available
        ? getEeClient(requireDefined(appConfig.ee.host, `EE is not available`), currentWorkspace.id)
        : undefined,
    [appConfig.ee.available, appConfig.ee.host, currentWorkspace.id]
  );
  useEffect(() => {
    if (appConfig.auth?.firebasePublic && appConfig.ee.available && eeClient) {
      (async () => {
        try {
          const classicProject = await eeClient.checkClassicProject();
          if (!classicProject.ok) {
            log.atError().log("Classic project check error", classicProject);
            setClassicProject({ active: false, ok: false, project: null, uid: null, name: null });
            return;
          }
          setClassicProject(classicProject);
          log.atInfo().log("Classic project", classicProject);
        } catch (e) {
          log.atError().log("Can't check for classic project", e);
          setClassicProject({ active: false, ok: false, project: null, uid: null, name: null });
        }
      })();
    }
  }, [eeClient, appConfig.auth, appConfig.ee.available]);

  return <ClassicProjectContext.Provider value={classicProject}>{children}</ClassicProjectContext.Provider>;
};
