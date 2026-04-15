import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

window.addEventListener('error', (event) => {
  console.error('Global error caught:', event.error);
  event.preventDefault();
  
  // Error handling logic
  const errorMessage = event.error?.message || event.message || 'An unexpected error occurred';
  console.log('Error message:', errorMessage);
  
  return false;
});

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  event.preventDefault();
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);