import * as React from "react";
import { useEffect } from "react";
import { Link, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useJitsu } from "@jitsu/jitsu-react";
import { useUser } from "./ConfigurationProvider";
import "./Page.css";
import { omit } from "lodash";

export default function Page() {
  const user = useUser();
  const { analytics } = useJitsu();
  const location = useLocation();

  useEffect(() => {
    analytics.identify(user?.id, omit(user, ["id"]));
  }, [user?.id, user]);

  useEffect(() => {
    analytics.page();
  }, [location]);

  return (
    <div>
      <Routes>
        <Route path={"/"} element={<Layout />}>
          <Route path="page2" element={<></>} />
          <Route path="" element={<></>} />
        </Route>
      </Routes>
    </div>
  );
}

function Layout() {
  const location = useLocation();
  return (
    <div>
      <h3>Auto Page Tracking</h3>
      <p>For automatic page tracking use following code:</p>
      <pre>
        {[
          "const { analytics } = useJitsu();",
          "const location = useLocation();",
          "useEffect(() => {",
          "   analytics.page()",
          "}, [location]);",
        ].join("\n")}
      </pre>
      <h3>To test automatic page tracking go to the second page and back.</h3>
      <ul>
        <li>
          <Link to={""}>Go to first page</Link> {location.pathname === "/" && <b>(current)</b>}
        </li>
        <li>
          <Link to={"page2"}>Go to second page</Link> {location.pathname === "/page2" && <b>(current)</b>}
        </li>
      </ul>
      <Outlet />
    </div>
  );
}
