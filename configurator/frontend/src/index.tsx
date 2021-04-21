// @Libs
import React  from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter, Route } from 'react-router-dom';
import * as monacoEditor from 'monaco-editor';
// @App component
import App from './App';
// @Styles
import './index.less'

monacoEditor.editor.defineTheme('own-theme', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    {
      foreground: '75715e',
      token: 'comment'
    }
  ],
  colors: {
    'editor.foreground': '#F8F8F2',
    'editor.background': '#111827',
    'editor.selectionBackground': '#49483E',
    'editor.lineHighlightBackground': '#111827',
    'editorCursor.foreground': '#F8F8F0',
    'editorWhitespace.foreground': '#3B3A32',
    'editorIndentGuide.activeBackground': '#9D550FB0',
    'editor.selectionHighlightBorder': '#222218'
  }
});

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
