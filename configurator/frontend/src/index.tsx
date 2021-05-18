// @Libs
import React  from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter, Route } from 'react-router-dom';
// @App component
import App from './App';
// @Styles
import './index.less'

let basename;
if (window.location.pathname.indexOf('/configurator') === 0) {
  //hack that makes the app work in Heroku env, when the app isn't deployed at root path
  basename = '/configurator';
} else {
  basename = process.env.APP_PATH || undefined;
}

ReactDOM.render(
  <BrowserRouter basename={basename}>
    <App />
  </BrowserRouter>,
  document.getElementById('root'));
