import React from "react";
import { GetServerSideProps } from "next";
import { AdminLayout } from "../components/AdminLayout";
import { requireAdmin } from "../lib/admin-guard";

type BillingProps = { email: string };

export const getServerSideProps: GetServerSideProps<BillingProps> = ctx => requireAdmin(ctx);

export default function BillingPage({ email }: BillingProps) {
  return (
    <AdminLayout email={email}>
      <h1 className="text-2xl font-semibold text-neutral-900">Billing</h1>
      <p className="text-neutral-500 mt-2">Billing dashboard — coming soon.</p>
    </AdminLayout>
  );
}
