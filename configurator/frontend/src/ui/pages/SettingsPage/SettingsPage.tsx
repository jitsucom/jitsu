// @Libs
import { useCallback } from 'react';
import { useHistory, Switch, Route, Redirect } from 'react-router-dom';
// @Components
import { UserSettings } from 'lib/components/UserSettings/UserSettings';
// @View
import { SettingsPageView } from './SettingsPageView';

const SETTINGS_PAGE_ROUTE = '/settings';

const settingsConfigArray = [
  {
    name: 'user',
    displayTitle: 'User',
    route: '/user',
    component: <UserSettings />
  },
  {
    name: 'billing',
    displayTitle: 'Billing',
    route: '/billing',
    component: 'This section is yet to come'
  }
] as const;

export const settingsPageRoutes = [
  SETTINGS_PAGE_ROUTE,
  `${SETTINGS_PAGE_ROUTE}/*`,
  ...settingsConfigArray.map(({ route }) => `${SETTINGS_PAGE_ROUTE}${route}`)
]

const makeRoute = (subroute: string) => `${SETTINGS_PAGE_ROUTE}${subroute}`

type SettingsConfigArray = typeof settingsConfigArray;
type SettingsSectionName = SettingsConfigArray[number]['name']
type goTo = (sectionName: SettingsSectionName) => void;

export const SettingsPage: React.FC = () => {

  const history = useHistory();

  const handleGoTo = useCallback<goTo>((sectionName) => {
    history.push(
      settingsConfigArray.find(item => item.name === sectionName).route
    );
  }, [history])

  return (
    <SettingsPageView
      config={settingsConfigArray}
      handleGoToSection={handleGoTo}
    >
      <Switch>
        {settingsConfigArray.map(({ name, route, component }) => {
          return (
            <Route key={name} path={makeRoute(route)} exact>
              {component}
            </Route>
          );
        })}
        <Redirect to={makeRoute(settingsConfigArray[0].route)} />
      </Switch>
    </SettingsPageView>
  );
}