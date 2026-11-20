import { MASKED_SECRET } from "./destinations";

/**
 * Which option of a `oneOf` field the editor shows for the saved value of its discriminator (the field every option
 * fixes with a `const`). For `replication_method` the CDC option is never offered, so a saved CDC value, or none, shows
 * the first other option.
 *
 * JITSU-284: while a connector spec is missing the saved value reaches the editor as the mask. It says nothing about the
 * option that was saved, so nothing is selected, as for any other `oneOf`. Showing "the first other option" would make its
 * form write that option's constant over the mask, and a save would then change the saved method.
 */
export function pickOneOfOption(
  oneOf: any[],
  discriminatorKey: string,
  discriminatorValue: unknown,
  name: string
): { selected: any; selectedIdx: number; removeIdx: number } {
  let selected: any;
  let selectedIdx = 0;
  let removeIdx = -1;
  for (let i = 0; i < oneOf.length; i++) {
    const o = oneOf[i];
    if (
      o.properties[discriminatorKey].const === discriminatorValue ||
      o.properties[discriminatorKey].enum?.[0] === discriminatorValue
    ) {
      selected = o;
      selectedIdx = i;
      break;
    }
  }
  //Hide CDC option for replication_method
  if (name === "replication_method") {
    for (let i = 0; i < oneOf.length; i++) {
      const o = oneOf[i];
      if (o.properties[discriminatorKey].const === "CDC" || o.properties[discriminatorKey].enum?.[0] === "CDC") {
        removeIdx = i;
        break;
      }
    }
    if (selectedIdx === removeIdx && discriminatorValue !== MASKED_SECRET) {
      for (let i = 0; i < oneOf.length; i++) {
        if (i !== removeIdx) {
          selected = oneOf[i];
          selectedIdx = i;
          break;
        }
      }
    }
  }
  return { selected, selectedIdx, removeIdx };
}
