import { Building2, ChevronDown } from 'lucide-react'
import styles from './ProviderScope.module.css'

function ProviderScope({ providers = [], value = 'all', onChange }) {
  return (
    <label className={styles.scope}>
      <span className={styles.label}>查看范围</span>
      <span className={styles.control}>
        <Building2 size={15} aria-hidden="true" />
        <select
          aria-label="选择中转站"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="all">全部中转站</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}{provider.ok === false ? '（异常）' : ''}
            </option>
          ))}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </span>
    </label>
  )
}

export default ProviderScope
