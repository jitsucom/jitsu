import React, { PropsWithChildren } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Button } from "antd";
import { LogoutOutlined } from "@ant-design/icons";

const navItems: { href: string; label: string }[] = [
  { href: "/", label: "Billing" },
  { href: "/admin-workspaces", label: "Admin Workspaces" },
];

/**
 * Top-bar shell for the admin UI. Layout is plain Tailwind; AntD is used only
 * for the controls (the logout button).
 */
export const AdminLayout: React.FC<PropsWithChildren<{ email: string }>> = ({ email, children }) => {
  const router = useRouter();

  const onLogout = async () => {
    try {
      await fetch("/api/admin/session", { method: "DELETE" });
    } finally {
      window.location.href = "/login?loggedOut=1";
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      <header className="flex items-center h-14 px-6 bg-white border-b border-neutral-200">
        <span className="font-semibold text-neutral-900 text-base mr-8">Jitsu Admin</span>
        <nav className="flex items-center gap-1 flex-1">
          {navItems.map(item => {
            const active = router.pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                  active
                    ? "bg-indigo-50 text-indigo-700 font-medium"
                    : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-500">{email}</span>
          <Button size="small" icon={<LogoutOutlined />} onClick={onLogout}>
            Logout
          </Button>
        </div>
      </header>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
};
