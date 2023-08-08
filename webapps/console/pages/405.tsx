import { GlobalError } from "../components/GlobalError/GlobalError";

export default function Custom405() {
  return <GlobalError error={{ message: "405 - Method is not allowed" }} hideActions={true} />;
}
