/* eslint-disable */
import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter, Route } from 'react-router-dom';
import App from './App';
import './index.less'

let root = React.createElement(
  BrowserRouter,
  {},
  <Route
    render={(props) => {
      return <App location={props.location.pathname} />;
    }}
  />
);
ReactDOM.render(root, document.getElementById('root'));
