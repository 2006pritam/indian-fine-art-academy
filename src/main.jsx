import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import { NotificationProvider } from './components/NotificationBanner.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <NotificationProvider>
      <App />
    </NotificationProvider>
  </React.StrictMode>,
)
