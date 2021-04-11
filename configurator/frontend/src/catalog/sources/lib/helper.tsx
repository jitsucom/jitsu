import {intType, jsonType, Parameter, selectionType, SourceConnector, stringType} from "../types";
import * as React from 'react';
import {allSingerTaps} from "./singer";
import {ReactNode} from "react";

export const singerConfigParams: Record<string, (tap: string) => Parameter> = {
    catalogJson: (tap: string): Parameter => {
        return {
            displayName: "Singer Catalog JSON",
            id: "catalog",
            type: jsonType,
            required: true,
            documentation: <>
                Singer <a href="https://github.com/singer-io/getting-started/blob/master/docs/SPEC.md#catalog">catalog</a> that defines
                data layout. <a href={`https://github.com/singer-io/${tap}`}>Read catalog documentation for {tap}</a>
            </>,
            defaultValue: {}
        }
    },
    stateJson: (tap: string): Parameter => {
        return {
            displayName: "Singer Initial State JSON",
            id: "state",
            type: jsonType,
            documentation: <>
                Singer initial <a href="https://github.com/singer-io/getting-started/blob/master/docs/SPEC.md#state">state</a>. For most cases
                should be empty

                <a href={`https://github.com/singer-io/${tap}`}>Read documentation for {tap}</a>
            </>,
            defaultValue: {}
        }
    },
    propertiesJson: (tap: string): Parameter => {
        return {
            displayName: "Singer Properties JSON",
            id: "properties",
            type: jsonType,
            documentation: <>
                Singer properties that defines resulting schema. <a href={`https://github.com/singer-io/${tap}`}>Read documentation for {tap}</a>
            </>,
            defaultValue: {}
        }
    },
    configJson: (tap: string): Parameter => {
        return {
            displayName: "Singer Config JSON",
            id: "config",
            type: jsonType,
            required: true,
            documentation: <>
                Singer <a href={"https://github.com/singer-io/getting-started/blob/master/docs/SPEC.md#state"}>configuration</a>. <a href={`https://github.com/singer-io/${tap}`}>Read documentation
                for {tap}</a>
            </>,
            defaultValue: {}
        }
    },
}


export type ParametersCustomization = {
    /**
     * Replacement for singerConfigParams.customConfig
     */
    customConfig?: Parameter[]
    legacyProperties?: boolean
}

/**
 * Prefix each parameter id with given prefix
 */
export function prefixParameters(prefix: string, parameters: Parameter[]) {
    return parameters.map(p => {
        return {
            ...p,
            id: prefix + p.id,
        }
    });
}

/**
 * Customizes parameters for singer tap.
 */
export function customParameters(tap: string, params: ParametersCustomization) {
    return [
        ...(params.customConfig ? prefixParameters("config.", params.customConfig) : [singerConfigParams.customConfig(tap)]),
        params.legacyProperties ? singerConfigParams.propertiesJson(tap) : singerConfigParams.catalogJson(tap),
        singerConfigParams.stateJson(tap)

    ]
}

export interface SingerTap {
    pic: ReactNode
    displayName: string
    tap: string,
    //we consider this tap as stable and production ready
    stable: boolean
    //We have a native equivalent
    hasNativeEquivalent: boolean,
    /**
     * If the tap uses legacy properties.json instead of catalog.json
     */
    legacyProperties?: boolean
    /**
     * If tap defines it's own parameters instead of
     * default singer params
     */
    parameters?: Parameter[]

}


/**
 * Not a common Source connector.
 */
export const makeSingerSource = (singerTap: SingerTap): SourceConnector => {
    return {
        isSingerType: true,
        pic: singerTap.pic,
        displayName: singerTap.displayName,
        id: `singer-${singerTap.tap}`,
        collectionTypes: [],
        collectionParameters: [],
        configParameters: [
            {
                displayName: "Singer Tap",
                id: "tap",
                type: stringType,
                required: true,
                documentation: <>Id of Singer Tap</>,
                constant: singerTap.tap
            },
            ...(singerTap.parameters ?? [
                singerConfigParams.configJson(singerTap.tap),
                singerTap.legacyProperties ? singerConfigParams.propertiesJson(singerTap.tap) : singerConfigParams.catalogJson(singerTap.tap),
                singerConfigParams.stateJson(singerTap.tap)
            ])
        ],
    }
}


