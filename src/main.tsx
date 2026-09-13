/**
 * Entry point.
 *
 * StrictMode is on: it double-invokes effects in development, which is exactly the
 * pressure that surfaces lifecycle bugs in the Phaser host and the loading flow
 * before they reach a phone.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './app/Root';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element in index.html');

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
