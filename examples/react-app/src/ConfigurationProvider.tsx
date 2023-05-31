import * as React from "react";
import { ReactNode, useState } from "react";
import "./Page.css";

interface User {
  id: string;
  name?: string;
  email?: string;
}

const defaultJitsuUrl = "http://localhost:3000";

interface Configuration {
  user?: User;
  jitsuURL: string;
}

const ConfigurationContext = React.createContext<Configuration | undefined>(undefined);

export function useUser(): User | undefined {
  return React.useContext(ConfigurationContext)?.user || undefined;
}

export function useJitsuUrl(): string {
  return React.useContext(ConfigurationContext)?.jitsuURL || defaultJitsuUrl;
}

export default function ConfigurationProvider(props: { children?: ReactNode }) {
  const initialUrl = localStorage.getItem("jitsuURL") || defaultJitsuUrl;
  const initialUser = localStorage.getItem("jitsuUser")
    ? JSON.parse(localStorage.getItem("jitsuUser") || "{}")
    : undefined;
  const [draftJitsuUrl, setDraftJitsuUrl] = useState(initialUrl);
  const [draftUser, setDraftUser] = useState<User | undefined>(initialUser);

  const [jitsuUrl, setJitsuUrl] = useState(initialUrl);
  const [user, setUser] = useState(initialUser);

  const patchUser = (p: Partial<User>) => {
    setDraftUser({ ...(draftUser || {}), ...p } as User);
  };

  return (
    <>
      <div className="max-w-4xl  mx-auto border p-12 pb-0">
        <h1>Configure</h1>
        <div className="flex items-center mb-6">
          <div className="configTitle">Jitsu URL:</div>
          <div className="w-96 flex justify-start pr-6">
            <input
              className={"w-full"}
              value={draftJitsuUrl}
              onChange={e => {
                if (e.target.value) {
                  setDraftJitsuUrl(e.target.value);
                }
              }}
            />
          </div>
          <div>
            <button
              onClick={() => {
                localStorage.setItem("jitsuURL", draftJitsuUrl);
                setJitsuUrl(draftJitsuUrl);
              }}
            >
              Apply
            </button>
          </div>
        </div>
        <div className="flex items-center mb-2">
          <div className="configTitle">User Id:</div>
          <div className="w-96 flex justify-start pr-6">
            <input
              value={draftUser?.id}
              onChange={e => {
                if (e.target.value) {
                  patchUser({ id: e.target.value });
                }
              }}
            />
          </div>
        </div>
        <div className="flex items-center mb-2">
          <div className="configTitle">User Email:</div>
          <div className="w-96 flex justify-start pr-6">
            <input
              value={draftUser?.email}
              onChange={e => {
                patchUser({ email: e.target.value || undefined });
              }}
            />
          </div>
        </div>
        <div className="flex items-center mb-2">
          <div className="configTitle">User Name:</div>
          <div className="w-48 flex justify-start pr-6">
            <input
              value={draftUser?.name}
              onChange={e => {
                patchUser({ name: e.target.value || undefined });
              }}
            />
          </div>
          <div>
            <button
              className="mr-4"
              onClick={() => {
                setUser(draftUser);
                localStorage.setItem("jitsuUser", JSON.stringify(draftUser));
              }}
            >
              Apply
            </button>
            <button>Reset</button>
          </div>
        </div>
      </div>

      <ConfigurationContext.Provider value={{ user: user?.id ? user : undefined, jitsuURL: jitsuUrl }}>
        <div>{props.children}</div>
      </ConfigurationContext.Provider>
    </>
  );
  // return (
  //   <div>
  //     <div style={{ width: "100%", textAlign: "right" }}>
  //       {draftUser && draftUser.id ? (
  //         <div>
  //           Logged in as{" "}
  //           <b>
  //             {draftUser.name}({draftUser.email})
  //           </b>{" "}
  //           <button onClick={logout} className={"large"}>
  //             Logout
  //           </button>{" "}
  //           to test <b>'logout'</b> custom tracking event.
  //         </div>
  //       ) : (
  //         <div>
  //           <button
  //             className={"large"}
  //             onClick={() => {
  //               const id = prompt("Enter draftUser id");
  //               if (id) {
  //                 const name = prompt("Enter draftUser name") || "";
  //                 const email = prompt("Enter draftUser email") || "";
  //                 login({ id: id, name: name, email: email });
  //               }
  //             }}
  //           >
  //             Login
  //           </button>{" "}
  //           to test <b>'identify'</b> event
  //         </div>
  //       )}
  //     </div>
  //     <br />
  //     <userContext.Provider value={draftUser}>
  //       <div>{props.children}</div>
  //     </userContext.Provider>
  //   </div>
  //);
}
