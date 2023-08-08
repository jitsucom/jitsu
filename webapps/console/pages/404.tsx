import { GlobalError } from "../components/GlobalError/GlobalError";

export default function Custom404() {
  return <GlobalError error={{ message: "404 - Page not found" }} hideActions={true} />;
}
