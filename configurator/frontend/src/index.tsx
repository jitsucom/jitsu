// @Libs
import ReactDOM from 'react-dom';
import { BrowserRouter } from 'react-router-dom';
// @MobX
import 'stores/_setupMobx';
// @App component
import App from './App';
// @Styles
import './index.less';
import { getBaseUIPath } from 'lib/commons/pathHelper';

ReactDOM.render(
  <BrowserRouter basename={getBaseUIPath()}>
    <App />
  </BrowserRouter>,
  document.getElementById('root')
);
