import { useServices } from "../../../hooks/useServices"
import GetStartedPage from "./GetStartedPage"

export default function SignupPage() {
  const services = useServices()
  return (
    <GetStartedPage
      oauthSupport={services.userService.getLoginFeatures().oauth}
      ssoAuthLink={services.userService.getSSOAuthLink()}
      login={false}
      useCloudHero={services.userService.getLoginFeatures().oauth}
    />
  )
}
