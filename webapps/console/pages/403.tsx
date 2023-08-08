import { GlobalError } from "../components/GlobalError/GlobalError";

export default function Custom403() {
  return <GlobalError error={{ message: "403 - Not authorized" }} hideActions={true} />;
}
