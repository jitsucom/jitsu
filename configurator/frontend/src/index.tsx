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

const BASE_PATH = getBaseUIPath();

ReactDOM.render(
  <BrowserRouter basename={BASE_PATH}>
    <App />
  </BrowserRouter>,
  document.getElementById('root')
);
