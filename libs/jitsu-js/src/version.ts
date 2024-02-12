import pkg from "../package.json";

const jitsuVersion = pkg.version !== "0.0.0" ? pkg.version : "2.0.0";
const jitsuLibraryName = "@jitsu/js";

export { jitsuVersion, jitsuLibraryName };
