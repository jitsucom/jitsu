import React from "react";
import { Button } from "antd";
import { AuditLog } from "../../components/AuditLog/AuditLog";

const AdminAuditLogPage: React.FC = () => {
  return (
    <div className="p-12">
      <div className="flex justify-end mb-6">
        <Button size="large" type="primary" href={"/"}>
          Back
        </Button>
      </div>
      <AuditLog title="Admin Audit Log" />
    </div>
  );
};

export default AdminAuditLogPage;
