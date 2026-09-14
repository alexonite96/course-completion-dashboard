import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ManagerView from './components/onboarding/ManagerView';
import './index.css';

const managerMatch = /^\/onboarding\/m\/([^/]+)/.exec(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {managerMatch ? <ManagerView slug={managerMatch[1]} /> : <App />}
  </StrictMode>,
);
