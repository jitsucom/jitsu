import React from "react";
import { GetServerSideProps } from "next";
import { AdminLayout } from "../components/AdminLayout";
import { requireAdmin } from "../lib/admin-guard";

type AdminWorkspacesProps = { email: string };

export const getServerSideProps: GetServerSideProps<AdminWorkspacesProps> = ctx => requireAdmin(ctx);

export default function AdminWorkspacesPage({ email }: AdminWorkspacesProps) {
  return (
    <AdminLayout email={email}>
      <h1 className="text-2xl font-semibold text-neutral-900">Admin Workspaces</h1>
      <p className="text-neutral-500 mt-2">Workspace administration — coming soon.</p>
    </AdminLayout>
  );
}
