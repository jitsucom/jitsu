import { useApi } from "../../lib/useApi";
import { useRouter } from "next/router";
import { Loader2 } from "lucide-react";
import { ErrorCard } from "../../components/GlobalError/GlobalError";
import { JitsuButton } from "../../components/JitsuButton/JitsuButton";
import { FaArrowLeft } from "react-icons/fa";
import { JsonAsTable } from "../../components/JsonAsTable/JsonAsTable";

const View = ({ data }) => {
  const router = useRouter();
  return (
    <div className="p-12">
      <div className="flex justify-between mb-12">
        <div className="flex space-x-2 items-center"></div>
        <JitsuButton icon={<FaArrowLeft />} size="large" type="primary" onClick={() => router.back()}>
          Go back
        </JitsuButton>
      </div>
      <JsonAsTable
        rows={data}
        columnOptions={{
          baseInvoiceId: { omit: true },
          quota: { omit: true },
          workspaceId: { type: "link", href: (val, row) => `/${row.workspaceId}` },
          destinationEvents: { type: "number" },
          overageEvents: { type: "number" },
          overageFee: { type: "number" },
          overageFeeFinal: { omit: true },
          discountPercentage: { omit: true },
          coupon: { omit: true },
          couponName: { omit: true },
          invoiceHelper: { omit: true },
          workspaceSlug: { omit: true },
          workspaceName: { type: "link", href: (val, row) => `/${row.workspaceSlug}` },
        }}
      />
    </div>
  );
};

export const OverageBillingPage = () => {
  const { data, isLoading, error } = useApi(`/api/$all/ee/report/overage`);
  if (isLoading) {
    return (
      <div className="w-full h-full flex justify-center items-center">
        <Loader2 className="h-16 w-16 animate-spin" />
      </div>
    );
  } else if (error) {
    return (
      <div className="w-full h-full flex justify-center items-center">
        <ErrorCard error={error} />
      </div>
    );
  }
  return <View data={data.result} />;
};

export default OverageBillingPage;
