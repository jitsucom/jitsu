// @Libs
import React  from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter, Route } from 'react-router-dom';
// @App component
import App from './App';
// @Styles
import './index.less'

ReactDOM.render(
  <BrowserRouter basename={process.env.APP_PATH}>
    <App />
  </BrowserRouter>,
  document.getElementById('root'));
