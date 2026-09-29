import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { RegionSelector } from './app/RegionSelector';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('The renderer root element is missing.');
}

const isRegionSelector =
  new URLSearchParams(window.location.search).get('window') === 'region-selector';

createRoot(rootElement).render(
  <StrictMode>{isRegionSelector ? <RegionSelector /> : <App />}</StrictMode>,
);
