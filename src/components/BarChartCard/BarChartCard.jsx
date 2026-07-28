import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { formatTokens, quotaToUSD } from '../../api/client'
import styles from './BarChartCard.module.css'

function CustomTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    const p = payload[0].payload
    return (
      <div className={styles.tooltip}>
        <p className={styles.tooltipLabel}>{label}</p>
        <p className={styles.tooltipValue}>调用 {p.calls} 次 · {formatTokens(p.promptTokens + p.completionTokens)} tokens</p>
        <p className={styles.tooltipValue}>成本 ${quotaToUSD(p.quota).toFixed(4)}</p>
      </div>
    )
  }
  return null
}

function BarChartCard({ data = [] }) {
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.title}>模型分布</h3>
        <span className={styles.subtitle}>按 Token 消耗量</span>
      </div>
      <div className={styles.chartWrapper}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#dfe3df" vertical={false} />
            <XAxis
              dataKey="model"
              tick={{ fontSize: 11, fill: '#606763' }}
              axisLine={{ stroke: '#dfe3df' }}
              tickLine={false}
              interval={0}
              angle={-15}
              textAnchor="end"
              height={50}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#606763' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(val) => formatTokens(val)}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f4f5f3' }} />
            <Bar
              dataKey="promptTokens"
              name="Prompt"
              stackId="t"
              fill="#087f5b"
              radius={[0, 0, 0, 0]}
              maxBarSize={56}
              animationDuration={1200}
            />
            <Bar
              dataKey="completionTokens"
              name="Completion"
              stackId="t"
              fill="#72a190"
              radius={[6, 6, 0, 0]}
              maxBarSize={56}
              animationDuration={1200}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default BarChartCard
