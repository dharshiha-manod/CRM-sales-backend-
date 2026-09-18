import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { IndustryProvider } from './industry/IndustryContext';
import 'leaflet/dist/leaflet.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IndustryProvider>
      <App />
    </IndustryProvider>
  </StrictMode>
);
