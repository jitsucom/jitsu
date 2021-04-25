import { CurrentPlanProps } from './CurrentPlan.types';
import styles from './CurrentPlan.module.less';
import { Progress } from 'antd';

function numberWithCommas(x) {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
export const CurrentPlan: React.FC<CurrentPlanProps> = (props) => {
  const usagaPct = props.usage/props.limit*100;
  return <div>
    <div>You're on <b className="capitalize">{props.planTitle}</b> plan</div>
    <div>
      <div><Progress percent={usagaPct} showInfo={false} status={usagaPct >= 100 ? 'exception' : 'active'} /></div>
      <div className="text-xs">
        <span className="text-secondaryText">Used:  <b>{numberWithCommas(props.usage)} / {numberWithCommas(props.limit)}</b></span>
      </div>
    </div>
    <div className="text-center mt-2"><a href="https://jitsu.com/pricing">Pricing Info</a> • <a>Upgrade</a></div>
  </div>
}