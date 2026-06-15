import React from 'react'
import ReactDOM from 'react-dom/client'
import AntApp from 'antd/es/app'
import ConfigProvider from 'antd/es/config-provider'
import zhCN from 'antd/es/locale/zh_CN'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
)
