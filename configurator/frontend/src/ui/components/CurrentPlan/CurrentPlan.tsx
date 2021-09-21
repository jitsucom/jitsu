import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Progress } from 'antd';
import cn from 'classnames';
import {
  PaymentPlan,
  paymentPlans,
  PaymentPlanStatus
} from 'lib/services/Billing';
import { useServices } from 'hooks/useServices';
import { handleError } from 'lib/components/components';
import styles from './CurrentPlan.module.less';
import firestore from 'firebase/database';
import firebase from 'firebase';
import { withQueryParams } from 'utils/queryParams';

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
    (planStatus.eventsThisMonth / planStatus.currentPlan.eventsLimit) * 100;
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
                {numberWithCommas(planStatus.eventsThisMonth)} /{' '}
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
        currentPlanName={planStatus.currentPlan.name}
      />
    </>
  );
};

export const PlanUpgradeDialog: React.FC<{
  visible: boolean;
  hide: () => void;
  currentPlanName: string;
}> = ({ visible, hide, currentPlanName }) => {
  const [selectedPlan, setSelectedPlan] = useState<string>(currentPlanName);
  const [buttonLoading, setLoading] = useState(false);
  const services = useServices();

  const buttonProps = (plan: PaymentPlan) => {
    return {
      className: cn(
        styles.optionButton,
        selectedPlan === plan.name ? styles.selectedOption : null
      ),
      onClick: () => setSelectedPlan(plan.name)
    };
  };

  const handleProceedToCheckout = useCallback(async () => {
    setLoading(true);
    try {
      await services.analyticsService.track('upgrade_plan', {
        event: 'upgrade_plan',
        plan: selectedPlan,
        user: services.userService.getUser().email
      });
      window.location.href =
        services.billingService.generateCheckoutLink(selectedPlan);
    } catch (e) {
      handleError(e);
    } finally {
      setLoading(false);
    }
  }, [selectedPlan]);

  useEffect(() => {
    const flow = async () => {
      // const app = firebase.app();
      // const db = firebase.firestore();

      // console.log('Flow in progress');

      // await db
      //   .collection('subscriptions')
      //   .get()
      //   .then((res) =>
      //     console.log(
      //       'subs: ',
      //       res.docs.map((doc) => doc.data())
      //     )
      //   )
      //   .catch((err) => console.log('flow catched', err));
      const user_id = services.userService.getUser().uid;
      const result = fetch(
        withQueryParams('https://billing.jitsu.com/api/get-user-subscription', {
          user_id
        })
      );
      console.log('RESULT', result);
    };

    flow();
  }, []);

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
