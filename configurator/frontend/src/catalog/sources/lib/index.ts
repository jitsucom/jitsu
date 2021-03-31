import {allSingerTaps} from "./singer";
import {allNativeConnectors} from "./native";
import {makeSingerSource} from "./helper";

export const allSources = [
    ...allNativeConnectors,
    ...allSingerTaps.filter(tap => !tap.hasNativeEquivalent && tap.pic).map(tap => makeSingerSource(tap))
]
