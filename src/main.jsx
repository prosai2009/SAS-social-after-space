import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/base.css'
import './styles/ui.css'
import './styles/pages.css'

// apply saved theme before first paint
const theme = localStorage.getItem('sas_theme')
if (theme) document.documentElement.dataset.accent = theme
const motionPref = localStorage.getItem('sas_motion')
if (motionPref === 'off') document.documentElement.dataset.motion = 'off'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
