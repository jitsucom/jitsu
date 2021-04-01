import {Parameter, selectionType, stringType} from "../../sources/types";
import { ReactNode } from 'react';

export const modeParameter = (constValue?: string): Parameter => {
    return {
        id: "_formData.mode",
        displayName: "",
        documentation: <>
            In steam mode the data will be send to destination instantly.
        </>,
        required: true,
        defaultValue: constValue ?? "stream",
        constant: constValue ?? undefined,
        type: constValue ? stringType : selectionType(["stream", "batch"], 1)
    }
}

/**
 * Destination table name for DBS
 */
export const tableName = (customDocs?: ReactNode): Parameter => {
    return {
        id: `_formData.tableName`,
        displayName: "Table Name",
        documentation: customDocs ?? <>
            Table name (or table name template)
        </>,
        required: true,
        defaultValue: "events",
        type: stringType
    }
};

/**
 * Destination table name for API like connections
 */
export const tableNameAPI = (paramName: string = "tableName"): Parameter => {
    return {
        id: `_formData.${paramName}`,
        displayName: "Table Name",
        documentation: <>
            Table name (or table name template)
        </>,
        required: true,
        defaultValue: "events",
        type: stringType
    }
};