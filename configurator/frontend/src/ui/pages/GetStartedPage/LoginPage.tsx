import { useServices } from '../../../hooks/useServices';
import GetStartedPage from './GetStartedPage';

export default function LoginPage() {
  const services = useServices();
  return <GetStartedPage
    oauthSupport={services.userService.getLoginFeatures().oauth}
    login={true}
    useCloudHero={services.userService.getLoginFeatures().oauth} />
}