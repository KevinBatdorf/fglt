import '@fontsource-variable/fraunces';
import '@fontsource-variable/fraunces/full-italic.css';
import '@fontsource-variable/inter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
// Side-effect: instantiates Electroview and connects the RPC channel.
import './lib/rpc';
import App from './App';

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
