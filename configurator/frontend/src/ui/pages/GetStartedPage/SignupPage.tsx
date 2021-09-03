import { useServices } from '../../../hooks/useServices';
import GetStartedPage from './GetStartedPage';

export default function SignupPage() {
  const services = useServices();
  return <GetStartedPage
    oauthSupport={services.userService.getLoginFeatures().oauth}
    login={false}
    useCloudHero={services.userService.getLoginFeatures().oauth} />
}