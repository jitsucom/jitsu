// @Libs
import ReactDOM from 'react-dom';
import { Router } from 'react-router-dom';
import { createBrowserHistory } from 'history';
// @MobX
import 'stores/_setupMobx';
// @App component
import App from './App';
// @Styles
import './index.less';
import { getBaseUIPath } from 'lib/commons/pathHelper';

const history = createBrowserHistory({ basename: getBaseUIPath() });

ReactDOM.render(
  <Router history={history}>
    <App />
  </Router>,
  document.getElementById('root')
);
