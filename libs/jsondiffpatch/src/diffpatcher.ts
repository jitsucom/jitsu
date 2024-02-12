import Processor from "./processor.js";
import Pipe from "./pipe.js";
import DiffContext from "./contexts/diff.js";
import PatchContext from "./contexts/patch.js";

import * as trivial from "./filters/trivial.js";
import * as nested from "./filters/nested.js";
import * as dates from "./filters/dates.js";
import type { Delta, Options } from "./types.js";

class DiffPatcher {
  processor: Processor;

  constructor(options?: Options) {
    this.processor = new Processor(options);
    this.processor.pipe(
      new Pipe<DiffContext>("diff")
        .append(nested.collectChildrenDiffFilter, trivial.diffFilter, dates.diffFilter, nested.objectsDiffFilter)
        .shouldHaveResult()!
    );
    this.processor.pipe(
      new Pipe<PatchContext>("patch")
        .append(nested.collectChildrenPatchFilter, trivial.patchFilter, nested.patchFilter)
        .shouldHaveResult()!
    );
  }

  options(options: Options) {
    return this.processor.options(options);
  }

  diff(left: unknown, right: unknown) {
    return this.processor.process(new DiffContext(left, right));
  }

  patch(left: unknown, delta: Delta) {
    return this.processor.process(new PatchContext(left, delta));
  }
}

export default DiffPatcher;
