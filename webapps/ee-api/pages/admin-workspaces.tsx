import React from "react";
import { AdminLayout } from "../components/AdminLayout";
import { RequireAdmin } from "../components/RequireAdmin";

export default function AdminWorkspacesPage() {
  return (
    <RequireAdmin>
      <AdminLayout>
        <h1 className="text-2xl font-semibold text-neutral-900">Admin Workspaces</h1>
        <p className="text-neutral-500 mt-2">Workspace administration — coming soon.</p>
      </AdminLayout>
    </RequireAdmin>
  );
}
