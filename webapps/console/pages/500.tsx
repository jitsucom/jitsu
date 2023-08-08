import { GlobalError } from "../components/GlobalError/GlobalError";

export default function Custom405() {
  return <GlobalError error={{ message: "500 - Internal server error" }} hideActions={true} />;
}
