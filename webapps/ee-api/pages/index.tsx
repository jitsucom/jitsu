import React from "react";
import { AdminLayout } from "../components/AdminLayout";
import { RequireAdmin } from "../components/RequireAdmin";

export default function BillingPage() {
  return (
    <RequireAdmin>
      <AdminLayout>
        <h1 className="text-2xl font-semibold text-neutral-900">Billing</h1>
        <p className="text-neutral-500 mt-2">Billing dashboard — coming soon.</p>
      </AdminLayout>
    </RequireAdmin>
  );
}
