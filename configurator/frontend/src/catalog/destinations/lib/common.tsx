import {Parameter, selectionType, stringType} from "../../sources/types";

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

export const tableName = (paramName: string = "tableName"): Parameter => {
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