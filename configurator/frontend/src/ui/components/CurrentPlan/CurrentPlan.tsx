import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Modal,
  Progress,
  ButtonProps,
  Typography,
  Divider
} from 'antd';
import cn from 'classnames';
import {
  generateCheckoutLink,
  generateCustomerPortalLink,
  PaymentPlan,
  paymentPlans,
  PaymentPlanStatus
} from 'lib/services/billing';
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
            {planStatus.currentPlan.id === 'free' ? 'Upgrade' : 'Manage'}
          </a>
        </div>
      </div>
      <PlanUpgradeDialog
        visible={upgradeDialogVisible}
        hide={() => setUpgradeDialogVisible(false)}
        planStatus={planStatus}
      />
    </>
  );
};

export const PlanUpgradeDialog: React.FC<{
  visible: boolean;
  hide: () => void;
  planStatus: PaymentPlanStatus;
}> = ({ visible, hide, planStatus }) => {
  const [selectedPlanId, setSelectedPlanId] = useState<string>(
    planStatus.currentPlan.id
  );
  const [buttonLoading, setLoading] = useState(false);
  const services = useServices();

  const selectedPlan = useMemo<PaymentPlan | null>(
    () => paymentPlans[selectedPlanId] ?? null,
    [selectedPlanId]
  );

  const actionLabel =
    selectedPlanId === planStatus.currentPlan.id ? (
      'Subscription Active'
    ) : selectedPlanId === 'enterprise' ? (
      <>
        <span className="mr-1">Contact</span>
        <Typography.Text copyable className="font-bold">
          sales@jitsu.com
        </Typography.Text>
      </>
    ) : selectedPlan.price_amount > planStatus.currentPlan.price_amount ? (
      'Upgrade'
    ) : (
      'Downgrade'
    );

  const buttonProps = (plan: PaymentPlan): ButtonProps => {
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
        event:
          selectedPlan.price_amount > planStatus.currentPlan.price_amount
            ? 'upgrade_plan'
            : 'downgrade_plan',
        plan: selectedPlan.id,
        user: services.userService.getUser().email
      });
      const user = services.userService.getUser();
      window.location.href = generateCheckoutLink({
        project_id: user.projects[0].id,
        current_plan_id: planStatus.currentPlan.id,
        plan_id_to_purchase: selectedPlan.id,
        user_email: user.email,
        success_url: window.location.href,
        cancel_url: window.location.href
      });
    } catch (e) {
      handleError(e);
    } finally {
      setLoading(false);
    }
  }, [selectedPlan, planStatus.currentPlan]);

  const handleProceedToCustomerPortal = useCallback(() => {
    setLoading(true);
    try {
      const user = services.userService.getUser();
      window.location.href = generateCustomerPortalLink({
        project_id: user.projects[0].id,
        current_plan_id: planStatus.currentPlan.id,
        user_email: user.email,
        return_url: window.location.href
      });
    } catch (e) {
      handleError(e);
    } finally {
      setLoading(false);
    }
  }, [selectedPlan]);

  return (
    <Modal
      destroyOnClose={true}
      title={<h1 className="text-xl m-0 p-0">Manage Subscription</h1>}
      visible={visible}
      onCancel={() => {
        hide();
      }}
      footer={visible}
    >
      <>
        {planStatus.isStripeCustomer && (
          <>
            <h3 className="font-bold">
              Manage Payment Methods and Billing Details
            </h3>
            <div className="flex justify-center items-center">
              <Button
                size="large"
                type="primary"
                className="mt-2 mb-2"
                onClick={handleProceedToCustomerPortal}
              >
                Go To Customer Portal
              </Button>
            </div>
            <Divider plain>or</Divider>
          </>
        )}
        <h3 className="font-bold">Subscribe to a Different Plan</h3>
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
        <div className="flex justify-center mt-6">
          {selectedPlanId === 'enterprise' ? (
            <span className="flex items-center text-base h-10">
              {actionLabel}
            </span>
          ) : selectedPlanId === planStatus.currentPlan.id ? (
            <span className="flex items-center text-base h-10">
              {actionLabel}
            </span>
          ) : (
            <Button
              size="large"
              loading={buttonLoading}
              type={selectedPlanId === 'enterprise' ? 'ghost' : 'primary'}
              disabled={selectedPlanId === planStatus.currentPlan.id}
              onClick={handleProceedToCheckout}
            >
              {actionLabel}
            </Button>
          )}
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
