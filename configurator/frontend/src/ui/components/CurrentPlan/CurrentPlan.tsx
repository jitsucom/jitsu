import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Progress } from 'antd';
import cn from 'classnames';
import {
  generateCheckoutLink,
  PaymentPlan,
  paymentPlans,
  PaymentPlanStatus
} from 'lib/services/Billing';
import { useServices } from 'hooks/useServices';
import { handleError } from 'lib/components/components';
import styles from './CurrentPlan.module.less';

function numberWithCommas(x) {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export type CurrentPlanProps = {
  planStatus: PaymentPlanStatus;
  onPlanChangeModalOpen: () => void;
};

export const CurrentPlan: React.FC<CurrentPlanProps> = ({
  planStatus,
  onPlanChangeModalOpen
}) => {
  const [upgradeDialogVisible, setUpgradeDialogVisible] = useState(false);
  const services = useServices();
  const usagaPct =
    (planStatus.eventsInCurrentPeriod / planStatus.currentPlan.eventsLimit) *
    100;
  return (
    <>
      <div>
        <div>
          You're on <b className="capitalize">{planStatus.currentPlan.name}</b>{' '}
          plan
        </div>
        <div>
          <div>
            <Progress
              percent={usagaPct}
              showInfo={false}
              status={usagaPct >= 100 ? 'exception' : 'active'}
            />
          </div>
          <table>
            <tr>
              <td className={styles.limitName}>Events</td>
              <td className={styles.limitValue}>
                {numberWithCommas(planStatus.eventsInCurrentPeriod)} /{' '}
                {numberWithCommas(planStatus.currentPlan.eventsLimit)}
              </td>
            </tr>
            <tr>
              <td className={styles.limitName}>Sources</td>
              <td className={styles.limitValue}>
                {numberWithCommas(planStatus.sources)} /{' '}
                {numberWithCommas(planStatus.currentPlan.sourcesLimit)}
              </td>
            </tr>
            <tr>
              <td className={styles.limitName}>Destinations</td>
              <td className={styles.limitValue}>
                {numberWithCommas(planStatus.destinations)} /{' '}
                {numberWithCommas(planStatus.currentPlan.destinationsLimit)}
              </td>
            </tr>
          </table>
        </div>
        <div className="text-center mt-2">
          <a href="https://jitsu.com/pricing">Pricing</a> •{' '}
          <a
            onClick={() => {
              onPlanChangeModalOpen();
              services.analyticsService.track('upgrade_plan_requested');
              setUpgradeDialogVisible(true);
            }}
          >
            Upgrade
          </a>
        </div>
      </div>
      <PlanUpgradeDialog
        visible={upgradeDialogVisible}
        hide={() => setUpgradeDialogVisible(false)}
        currentPlanId={planStatus.currentPlan.id}
      />
    </>
  );
};

export const PlanUpgradeDialog: React.FC<{
  visible: boolean;
  hide: () => void;
  currentPlanId: string;
}> = ({ visible, hide, currentPlanId }) => {
  const [selectedPlanId, setSelectedPlanId] = useState<string>(currentPlanId);
  const [buttonLoading, setLoading] = useState(false);
  const services = useServices();

  const buttonProps = (plan: PaymentPlan) => {
    return {
      className: cn(
        styles.optionButton,
        selectedPlanId === plan.id ? styles.selectedOption : null
      ),
      onClick: () => setSelectedPlanId(plan.id)
    };
  };

  const handleProceedToCheckout = useCallback(async () => {
    setLoading(true);
    try {
      await services.analyticsService.track('upgrade_plan', {
        event: 'upgrade_plan',
        plan: selectedPlanId,
        user: services.userService.getUser().email
      });
      const user = services.userService.getUser();
      window.location.href = generateCheckoutLink({
        project_id: user.projects[0].id,
        current_plan_id: currentPlanId,
        plan_id_to_purchase: selectedPlanId,
        user_email: user.email,
        success_url: window.location.href,
        cancel_url: window.location.href
      });
    } catch (e) {
      handleError(e);
    } finally {
      setLoading(false);
    }
  }, [selectedPlanId]);

  return (
    <Modal
      destroyOnClose={true}
      title="Change Plan"
      visible={visible}
      onCancel={() => {
        hide();
      }}
      footer={visible}
    >
      <>
        <div className="text">
          Please pick your new plan. We'll send you a payment link through
          email.
        </div>
        <div className={styles.plan}>
          <div>
            <div {...buttonProps(paymentPlans.free)}>Startup</div>
            <div className={styles.planPrice}>FREE</div>
          </div>
          <div>
            <div {...buttonProps(paymentPlans.growth)}>Growth</div>
            <div className={styles.planPrice}>$99 / month</div>
          </div>
          <div>
            <div {...buttonProps(paymentPlans.premium)}>Premium</div>
            <div className={styles.planPrice}>$299 / month</div>
          </div>
          <div>
            <div {...buttonProps(paymentPlans.enterprise)}>Enterprise</div>
            <div className={styles.planPrice}>custom</div>
          </div>
        </div>
        <div className="flex justify-center pt-6">
          <Button
            onClick={handleProceedToCheckout}
            size="large"
            type="primary"
            loading={buttonLoading}
          >
            Checkout
          </Button>
        </div>
        <div className="flex justify-center pt-3">
          <a target="_blank" href="https://jitsu.com" rel="noreferrer">
            Read more about pricing options
          </a>
        </div>
      </>
    </Modal>
  );
};
