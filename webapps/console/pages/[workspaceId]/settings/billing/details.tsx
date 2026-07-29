import { WorkspacePageLayout } from "../../../../components/PageLayout/WorkspacePageLayout";
import { BillingDetails } from "../../../../components/BillingDetails/BillingDetails";

const BillingDetailsPage: React.FC = () => {
  return (
    <WorkspacePageLayout doNotBlockWithBillingModals={true}>
      <BillingDetails />
    </WorkspacePageLayout>
  );
};

export default BillingDetailsPage;
