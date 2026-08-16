import { useState, useEffect } from 'react'
import { fetchConfig, saveConfig, triggerBrowserLogin, autoDetectBrowserSelectors, probeBrowserSelectors, pickBrowserSelector } from '../../api/client'
import { Plus, Trash2, Save, Server, LogIn, FlaskConical, CheckCircle2, AlertCircle, MousePointerClick, WandSparkles } from 'lucide-react'
import styles from './Settings.module.css'

const PROVIDER_TYPES = [
  { value: 'oneapi', label: 'OneAPI 兼容（自部署）' },
  { value: 'newapi', label: 'NewAPI 兼容（自部署）' },
  { value: 'browser', label: '浏览器抓取（商业中转站）' },
  { value: 'mock', label: '示例（演示用）' },
]

// 常见中转站预设：已知站点的 loginUrl / dataUrl，一键填充
// 选择器仍需登录后用「拾取」按钮自动生成
const PRESETS = [
  {
    id: 'wawapi',
    name: 'WawAPI',
    loginUrl: 'https://wawapii.com/login',
    dataUrl: 'https://wawapii.com/dashboard',
    note: '商业中转站，需登录后用拾取按钮配置字段',
  },
  {
    id: 'oneapi-openai',
    name: 'OneAPI（自部署）',
    type: 'oneapi',
    baseUrl: '',
    note: '请填入你的 OneAPI 实例地址和 System Access Token',
  },
]

// browser 类型可选字段名
// 标量字段 + 模型表（特殊处理，解析整个 table）
const SELECTOR_FIELDS = [
  { key: 'balance', label: '余额', hint: '账户剩余金额' },
  { key: 'todayTokens', label: '今日 Token', hint: '今日累计 Token 消耗' },
  { key: 'todayCost', label: '今日消费', hint: '今日花费金额' },
]

// 模型分布表（特殊字段）
const MODEL_TABLE_FIELD = { key: 'modelTable', label: '模型分布表', hint: '点击表格内任意单元格，自动识别整个表' }

function Settings() {
  const [config, setConfig] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [error, setError] = useState(null)
  // 浏览器操作状态：{ [providerId]: { status, message, probeResult } }
  const [browserOps, setBrowserOps] = useState({})

  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch((e) => setError(e.message))
  }, [])

  if (error && !config) return <div className={styles.errorBox}>{error}</div>
  if (!config) return <div className={styles.loading}>加载中…</div>

  const update = (next) => setConfig({ ...config, ...next })

  const updateProvider = (id, patchOrUpdater) => {
    setConfig((current) => ({
      ...current,
      providers: current.providers.map((provider) => {
        if (provider.id !== id) return provider
        const patch = typeof patchOrUpdater === 'function'
          ? patchOrUpdater(provider)
          : patchOrUpdater
        return { ...provider, ...patch }
      }),
    }))
  }

  const addProvider = () => {
    const id = `provider-${Date.now()}`
    update({
      providers: [
        ...config.providers,
        {
          id,
          name: '新中转站',
          type: 'browser',
          loginUrl: '',
          dataUrl: '',
          selectors: {},
          enabled: true,
        },
      ],
    })
  }

  // 应用预设：根据预设类型创建 provider
  const applyPreset = (preset) => {
    const id = `provider-${Date.now()}`
    if (preset.type === 'oneapi') {
      update({
        providers: [
          ...config.providers,
          {
            id,
            name: preset.name,
            type: 'oneapi',
            baseUrl: preset.baseUrl || '',
            apiToken: '',
            enabled: true,
          },
        ],
      })
    } else {
      // browser 类型预设
      update({
        providers: [
          ...config.providers,
          {
            id,
            name: preset.name,
            type: 'browser',
            loginUrl: preset.loginUrl || '',
            dataUrl: preset.dataUrl || '',
            selectors: {},
            waitMs: 3000,
            enabled: true,
          },
        ],
      })
    }
  }

  const removeProvider = (id) => {
    update({ providers: config.providers.filter((p) => p.id !== id) })
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await saveConfig(config)
      setSavedAt(Date.now())
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleLogin = async (provider) => {
    const id = provider.id
    setBrowserOps((s) => ({ ...s, [id]: { status: 'login-loading', message: '浏览器已启动，请在弹出的浏览器中登录后点击「✓ 完成登录并保存」按钮' } }))
    try {
      const result = await triggerBrowserLogin(provider)
      if (result.ok) {
        setBrowserOps((s) => ({ ...s, [id]: { status: 'login-done', message: `登录态已保存（${new Date(result.savedAt).toLocaleTimeString()}）` } }))
        // 仅更新当前 provider 的 hasAuth 标记，保留其他未保存的本地编辑
        setConfig((cur) => ({
          ...cur,
          providers: cur.providers.map((p) =>
            p.id === id ? { ...p, hasAuth: true } : p
          ),
        }))
      } else {
        setBrowserOps((s) => ({ ...s, [id]: { status: 'login-error', message: result.error || '登录失败' } }))
      }
    } catch (e) {
      setBrowserOps((s) => ({ ...s, [id]: { status: 'login-error', message: e.message } }))
    }
  }

  const handleProbe = async (provider) => {
    const id = provider.id
    setBrowserOps((s) => ({ ...s, [id]: { status: 'probe-loading', message: '正在抓取页面...' } }))
    try {
      const result = await probeBrowserSelectors(provider)
      if (result.ok) {
        setBrowserOps((s) => ({
          ...s,
          [id]: { status: 'probe-done', message: '探测完成', probeResult: result.result },
        }))
      } else {
        setBrowserOps((s) => ({ ...s, [id]: { status: 'probe-error', message: result.error || '探测失败' } }))
      }
    } catch (e) {
      setBrowserOps((s) => ({ ...s, [id]: { status: 'probe-error', message: e.message } }))
    }
  }

  const handleAutoDetect = async (provider) => {
    const id = provider.id
    setBrowserOps((state) => ({
      ...state,
      [id]: { status: 'auto-loading', message: '正在分析页面结构并验证候选字段...' },
    }))
    try {
      const response = await autoDetectBrowserSelectors(provider)
      if (!response.ok) throw new Error(response.error || '自动识别失败')

      const detected = response.result?.selectors || {}
      const detectedCount = Object.keys(detected).length
      if (detectedCount === 0) throw new Error('没有识别到可靠字段，请使用手动拾取')

      updateProvider(id, (current) => ({
        selectors: { ...(current.selectors || {}), ...detected },
      }))

      const probeResult = Object.fromEntries(Object.entries(detected).map(([field, selector]) => [
        field,
        {
          selector,
          found: true,
          text: response.result.samples?.[field] || '',
          value: response.result.confidence?.[field] === 'high' ? '高置信度' : '建议确认',
        },
      ]))
      const missing = response.result?.missing || []
      setBrowserOps((state) => ({
        ...state,
        [id]: {
          status: 'auto-done',
          message: `已识别 ${detectedCount}/4 个字段${missing.length ? `；未识别：${missing.join('、')}` : ''}。缓存命中率会自动从使用趋势接口读取。`,
          probeResult,
        },
      }))
    } catch (e) {
      setBrowserOps((state) => ({
        ...state,
        [id]: { status: 'auto-error', message: e.message },
      }))
    }
  }

  // 可视化拾取选择器：浏览器打开数据页，用户点击目标元素后自动填入
  // fieldKey === 'modelTable' 时拾取整个表格
  const handlePick = async (provider, fieldKey) => {
    const id = provider.id
    const label = fieldKey === 'modelTable' ? '模型分布表' : fieldKey
    setBrowserOps((s) => ({ ...s, [id]: { status: 'pick-loading', message: `浏览器已启动，请在页面上点击「${label}」对应的元素` } }))
    try {
      const result = await pickBrowserSelector(provider, fieldKey)
      if (result.ok && result.result?.selector) {
        // 自动填入选择器到对应字段
        updateProvider(id, (current) => ({
          selectors: { ...(current.selectors || {}), [fieldKey]: result.result.selector },
        }))
        setBrowserOps((s) => ({
          ...s,
          [id]: {
            status: 'pick-done',
            message: `已拾取：${result.result.selector}（抓到文本：「${result.result.text}」）`,
          },
        }))
      } else if (result.ok) {
        setBrowserOps((s) => ({ ...s, [id]: { status: 'pick-error', message: '未选择元素（已取消）' } }))
      } else {
        setBrowserOps((s) => ({ ...s, [id]: { status: 'pick-error', message: result.error || '拾取失败' } }))
      }
    } catch (e) {
      setBrowserOps((s) => ({ ...s, [id]: { status: 'pick-error', message: e.message } }))
    }
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>中转站配置</h2>
      <p className={styles.subtitle}>
        管理需监控的中转站。OneAPI 类型填 API Token；浏览器抓取类型需先点「登录」保存登录态，再配置数据页 URL 和 CSS 选择器。
        Token 与登录态仅保存在本地 <code>server/</code> 目录。
      </p>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>刷新策略</h3>
        </div>
        <label className={styles.field}>
          <span>刷新间隔（秒）</span>
          <input
            type="number"
            min="60"
            value={config.refreshIntervalSec || 300}
            onChange={(e) => update({ refreshIntervalSec: Number(e.target.value) })}
            className={styles.input}
          />
        </label>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>中转站列表（{config.providers.length}）</h3>
          <div className={styles.headerActions}>
            <div className={styles.presetGroup}>
              <span className={styles.presetLabel}>快速添加：</span>
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className={styles.presetBtn}
                  onClick={() => applyPreset(preset)}
                  title={preset.note}
                >
                  + {preset.name}
                </button>
              ))}
            </div>
            <button className={styles.addBtn} onClick={addProvider}>
              <Plus size={14} /> 自定义
            </button>
          </div>
        </div>

        <div className={styles.providerList}>
          {config.providers.map((p) => {
            const op = browserOps[p.id] || {}
            const browserBusy = ['login-loading', 'probe-loading', 'pick-loading', 'auto-loading'].includes(op.status)
            return (
              <div key={p.id} className={styles.providerCard}>
                <div className={styles.providerCardHeader}>
                  <Server size={16} />
                  <span className={styles.providerName}>{p.name}</span>
                  {p.type === 'browser' && (
                    <span className={`${styles.authBadge} ${p.hasAuth ? styles.authOk : styles.authMiss}`}>
                      {p.hasAuth ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                      {p.hasAuth ? '已登录' : '未登录'}
                    </span>
                  )}
                  <label className={styles.enableToggle}>
                    <input
                      type="checkbox"
                      checked={p.enabled !== false}
                      onChange={(e) => updateProvider(p.id, { enabled: e.target.checked })}
                    />
                    启用
                  </label>
                  <button className={styles.removeBtn} onClick={() => removeProvider(p.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>名称</span>
                    <input
                      value={p.name}
                      onChange={(e) => updateProvider(p.id, { name: e.target.value })}
                      className={styles.input}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>类型</span>
                    <select
                      value={p.type}
                      onChange={(e) => updateProvider(p.id, { type: e.target.value })}
                      className={styles.input}
                    >
                      {PROVIDER_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* OneAPI / NewAPI 字段 */}
                {(p.type === 'oneapi' || p.type === 'newapi') && (
                  <>
                    <label className={styles.field}>
                      <span>Base URL</span>
                      <input
                        value={p.baseUrl || ''}
                        placeholder="https://your-oneapi-host.com"
                        onChange={(e) => updateProvider(p.id, { baseUrl: e.target.value })}
                        className={styles.input}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>API Token {p.hasToken && !p.apiToken ? '（已保存）' : ''}</span>
                      <input
                        type="password"
                        value={p.apiToken || ''}
                        placeholder={p.hasToken ? '留空表示不修改' : '系统访问令牌'}
                        onChange={(e) => updateProvider(p.id, { apiToken: e.target.value })}
                        className={styles.input}
                      />
                    </label>
                  </>
                )}

                {/* 浏览器抓取字段 */}
                {p.type === 'browser' && (
                  <>
                    <label className={styles.field}>
                      <span>登录页 URL</span>
                      <input
                        value={p.loginUrl || ''}
                        placeholder="https://example.com/login"
                        onChange={(e) => updateProvider(p.id, { loginUrl: e.target.value })}
                        className={styles.input}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>登录成功后跳转的 URL 模式（可选，glob 格式）</span>
                      <input
                        value={p.loginWaitUrl || ''}
                        placeholder="**/dashboard 或 https://example.com/dashboard"
                        onChange={(e) => updateProvider(p.id, { loginWaitUrl: e.target.value })}
                        className={styles.input}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>数据页 URL（含余额和用量的页面）</span>
                      <input
                        value={p.dataUrl || ''}
                        placeholder="https://example.com/dashboard"
                        onChange={(e) => updateProvider(p.id, { dataUrl: e.target.value })}
                        className={styles.input}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>使用趋势 URL（可选）</span>
                      <input
                        value={p.usageUrl || ''}
                        placeholder="默认使用数据页同域下的 /usage"
                        onChange={(e) => updateProvider(p.id, { usageUrl: e.target.value })}
                        className={styles.input}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>页面渲染等待时间（毫秒，默认 3000）</span>
                      <input
                        type="number"
                        min="0"
                        value={p.waitMs ?? 3000}
                        onChange={(e) => updateProvider(p.id, { waitMs: Number(e.target.value) })}
                        className={styles.input}
                      />
                    </label>

                    <div className={styles.selectorsGroup}>
                      <div className={styles.selectorsHeader}>
                        <span className={styles.selectorsTitle}>字段选择器配置</span>
                        <span className={styles.selectorsBadge}>自动识别优先，拾取兜底</span>
                        <button
                          className={styles.autoDetectBtn}
                          onClick={() => handleAutoDetect(p)}
                          disabled={browserBusy || !p.hasAuth || !p.dataUrl}
                          title={!p.hasAuth ? '请先登录' : !p.dataUrl ? '请先填写数据页 URL' : '自动分析并填入全部字段'}
                        >
                          <WandSparkles size={13} />
                          {op.status === 'auto-loading' ? '识别中...' : '自动识别全部'}
                        </button>
                      </div>
                      <p className={styles.selectorsHint}>
                        自动识别会根据页面标签、数值位置和表头一次填写；未识别或结果不准确的字段再使用右侧「拾取」。
                      </p>

                      {/* 标量字段 */}
                      {SELECTOR_FIELDS.map((f) => (
                        <div key={f.key} className={styles.selectorRow}>
                          <span className={styles.selectorLabel} title={f.hint}>{f.label}</span>
                          <input
                            value={p.selectors?.[f.key] || ''}
                            placeholder="自动生成或手动填写"
                            onChange={(e) =>
                              updateProvider(p.id, {
                                selectors: { ...(p.selectors || {}), [f.key]: e.target.value },
                              })
                            }
                            className={styles.input}
                          />
                          <button
                            className={styles.pickBtn}
                            onClick={() => handlePick(p, f.key)}
                            disabled={
                              browserBusy ||
                              !p.hasAuth ||
                              !p.dataUrl
                            }
                            title={!p.hasAuth ? '请先登录' : !p.dataUrl ? '请先填写数据页 URL' : '点击拾取'}
                          >
                            <MousePointerClick size={12} />
                            拾取
                          </button>
                        </div>
                      ))}

                      <div className={`${styles.selectorRow} ${styles.autoSelectorRow}`}>
                        <span className={styles.selectorLabel} title="使用趋势图中的缓存命中百分比">
                          缓存命中率
                        </span>
                        <span className={styles.autoSource}>自动读取使用趋势接口</span>
                        <span className={styles.autoFieldBadge}>无需配置</span>
                      </div>

                      {/* 模型分布表：特殊字段，拾取任意单元格后自动定位整个表格 */}
                      <div className={styles.divider} />
                      <div className={styles.selectorRow}>
                        <span className={styles.selectorLabel} title={MODEL_TABLE_FIELD.hint}>
                          {MODEL_TABLE_FIELD.label}
                          <span className={styles.specialTag}>特殊</span>
                        </span>
                        <input
                          value={p.selectors?.[MODEL_TABLE_FIELD.key] || ''}
                          placeholder="拾取表格内任意单元格，会自动识别整个表"
                          onChange={(e) =>
                            updateProvider(p.id, {
                              selectors: { ...(p.selectors || {}), [MODEL_TABLE_FIELD.key]: e.target.value },
                            })
                          }
                          className={styles.input}
                        />
                        <button
                          className={styles.pickBtn}
                          onClick={() => handlePick(p, MODEL_TABLE_FIELD.key)}
                          disabled={
                            browserBusy ||
                            !p.hasAuth ||
                            !p.dataUrl
                          }
                          title={!p.hasAuth ? '请先登录' : !p.dataUrl ? '请先填写数据页 URL' : '点击拾取整个表格'}
                        >
                          <MousePointerClick size={12} />
                          拾取
                        </button>
                      </div>
                      <p className={styles.modelTableHint}>
                        点击表格中任意一个单元格（如某个模型的 Token 数），系统会自动识别整个表格结构，
                        解析出每个模型的 Token 数和成本用于分布图。
                      </p>
                    </div>

                    <div className={styles.browserActions}>
                      <button
                        className={styles.loginBtn}
                        onClick={() => handleLogin(p)}
                        disabled={browserBusy}
                      >
                        <LogIn size={14} />
                        {op.status === 'login-loading' ? '等待登录...' : '登录保存登录态'}
                      </button>
                      <button
                        className={styles.probeBtn}
                        onClick={() => handleProbe(p)}
                        disabled={browserBusy || !p.hasAuth}
                      >
                        <FlaskConical size={14} />
                        {op.status === 'probe-loading' ? '探测中...' : '测试选择器'}
                      </button>
                    </div>

                    {op.message && (
                      <div className={`${styles.opMessage} ${styles[op.status?.split('-')[1] || '']}`}>
                        {op.message}
                      </div>
                    )}

                    {op.probeResult && (
                      <div className={styles.probeResult}>
                        <div className={styles.probeResultTitle}>抓取结果：</div>
                        {Object.entries(op.probeResult).map(([field, info]) => (
                          <div key={field} className={styles.probeRow}>
                            <span className={styles.probeField}>{field}</span>
                            <code className={styles.probeSelector}>{info.selector}</code>
                            {info.found ? (
                              <>
                                <span className={styles.probeText}>「{info.text}」</span>
                                <span className={styles.probeValue}>→ {info.value}</span>
                              </>
                            ) : (
                              <span className={styles.probeNotFound}>未找到元素</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
          {config.providers.length === 0 && (
            <div className={styles.empty}>
              暂无中转站，点击右上角「新增」添加
            </div>
          )}
        </div>
      </div>

      <div className={styles.footer}>
        <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
          <Save size={14} />
          {saving ? '保存中...' : '保存配置'}
        </button>
        {savedAt && <span className={styles.savedHint}>已保存，下次刷新即生效</span>}
        {error && <span className={styles.errorHint}>{error}</span>}
      </div>
    </div>
  )
}

export default Settings
