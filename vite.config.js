import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // recharts 体积大且仅图表页使用，独立分包；
        // 挂件（?widget=1）不加载该 chunk
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['recharts'],
        },
      },
    },
  },
  server: {
    proxy: {
      // 将前端 /api 请求代理到本地后端代理服务
      '/api': {
        target: `http://127.0.0.1:${process.env.TOKEN_MONITOR_API_PORT || '3017'}`,
        changeOrigin: true,
      },
    },
  },
})
