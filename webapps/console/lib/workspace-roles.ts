import { z } from "zod";

export type WorkspaceRoleType = "owner" | "editor" | "analyst";

export const WorkspaceRolesZodType = z.enum(["owner", "editor", "analyst"]);

export type WorkspacePermissionsType = "readEntities" | "editEntities" | "deleteEntities" | "manageUsers";

export type WorkspaceRoleWithPermissions = {
  role: WorkspaceRoleType;
} & Record<WorkspacePermissionsType, boolean>;

export const WorkspaceRolePermissions: Record<WorkspaceRoleType, Record<WorkspacePermissionsType, boolean>> = {
  owner: {
    editEntities: true,
    deleteEntities: true,
    manageUsers: true,
    readEntities: true,
  },
  editor: {
    editEntities: true,
    deleteEntities: true,
    manageUsers: false,
    readEntities: true,
  },
  analyst: {
    editEntities: false,
    deleteEntities: false,
    manageUsers: false,
    readEntities: true,
  },
} as const;

export function hasPermission(role: WorkspaceRoleType, permission: WorkspacePermissionsType): boolean {
  return WorkspaceRolePermissions[role]?.[permission] ?? false;
}

export const WorkspaceRoleLabels: Record<WorkspaceRoleType, string> = {
  owner: "Owner",
  editor: "Editor",
  analyst: "Analyst",
};

export const WorkspaceRoleDescriptions: Record<WorkspaceRoleType, string> = {
  owner: "Can create, edit workspace entities and manage workspace users",
  editor: "Can create and edit workspace entities",
  analyst: "Read-only access to workspace data. Can trigger Syncs tasks runs.",
};

export const WorkspaceRoleConfig: Record<
  WorkspaceRoleType,
  {
    color: string;
    bgColor: string;
    borderColor: string;
    icon: string;
    style: {
      color: string;
      backgroundColor: string;
      borderColor: string;
    };
  }
> = {
  owner: {
    color: "text-gray-600",
    bgColor: "bg-gray-50",
    borderColor: "border-gray-200",
    icon: "Crown",
    style: {
      color: "#4b5563", // gray-600
      backgroundColor: "#f9fafb", // gray-50
      borderColor: "#e5e7eb", // gray-200
    },
  },
  editor: {
    color: "text-gray-600",
    bgColor: "bg-gray-50",
    borderColor: "border-gray-200",
    icon: "Edit3",
    style: {
      color: "#4b5563", // gray-600
      backgroundColor: "#f9fafb", // gray-50
      borderColor: "#e5e7eb", // gray-200
    },
  },
  analyst: {
    color: "text-gray-600",
    bgColor: "bg-gray-50",
    borderColor: "border-gray-200",
    icon: "BarChart3",
    style: {
      color: "#4b5563", // gray-600
      backgroundColor: "#f9fafb", // gray-50
      borderColor: "#e5e7eb", // gray-200
    },
  },
};
