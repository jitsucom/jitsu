// @Libs
import React  from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter, Route } from 'react-router-dom';
// @App component
import App from './App';
// @Styles
import './index.less'
import { getBaseUIPath } from 'lib/commons/pathHelper';

ReactDOM.render(
  <BrowserRouter basename={getBaseUIPath()}>
    <App />
  </BrowserRouter>,
  document.getElementById('root'));
