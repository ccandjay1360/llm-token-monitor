import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { formatTokens } from '../../api/client'
import styles from './LineChartCard.module.css'

function CustomTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    return (
      <div className={styles.tooltip}>
        <p className={styles.tooltipLabel}>{label}</p>
        {payload.map((p, i) => (
          <p key={i} className={styles.tooltipValue} style={{ color: p.color }}>
            {p.name}: {formatTokens(p.value)}
          </p>
        ))}
      </div>
    )
  }
  return null
}

function LineChartCard({ data = [] }) {
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.title}>Token 消耗趋势</h3>
        <span className={styles.subtitle}>近 14 天</span>
      </div>
      <div className={styles.chartWrapper}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#dfe3df" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12, fill: '#606763' }}
              axisLine={{ stroke: '#dfe3df' }}
              tickLine={false}
              tickFormatter={(v) => v.slice(5)}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#606763' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(val) => formatTokens(val)}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Line
              type="monotone"
              dataKey="promptTokens"
              name="Prompt"
              stroke="#087f5b"
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 6, fill: '#087f5b', stroke: '#fbfcfa', strokeWidth: 2 }}
              animationDuration={1200}
            />
            <Line
              type="monotone"
              dataKey="completionTokens"
              name="Completion"
              stroke="#72a190"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, fill: '#72a190', stroke: '#fbfcfa', strokeWidth: 2 }}
              animationDuration={1200}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default LineChartCard
