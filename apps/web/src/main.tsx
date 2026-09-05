import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CssBaseline } from '@mui/material';
import App from './App';
import { registerServiceWorker } from './pwa/registerServiceWorker';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <CssBaseline />
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

// AFTER the first render, deliberately. Registration is a side effect that the
// user's first paint must not wait on, and it is a no-op outside a production
// build (see the function's comment).
registerServiceWorker();
