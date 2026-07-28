import styles from './Help.module.css'

function Help() {
  return (
    <div className={styles.page}>
      <h2 className={styles.title}>使用指南</h2>
      <p className={styles.subtitle}>中转站 Token 消耗监控台使用指南</p>
      <div className={styles.card}>
        <details className={styles.faq}>
          <summary>支持哪些中转站？</summary>
          <p>当前已实现 OneAPI / NewAPI 兼容协议适配器，覆盖大部分主流中转站。若你的中转站协议不同，可在 <code>server/providers.js</code> 中扩展自定义适配器。</p>
        </details>
        <details className={styles.faq}>
          <summary>如何配置中转站？</summary>
          <p>1. 复制 <code>server/config.example.json</code> 为 <code>server/config.json</code>；2. 填入中转站 baseUrl 与系统访问令牌；3. 也可在前端「设置」页直接编辑后保存；4. 重启后端代理（<code>npm run dev:server</code>）后生效。</p>
        </details>
        <details className={styles.faq}>
          <summary>API Token 从哪里获取？</summary>
          <p>登录中转站后台，在「个人设置」或「令牌」页生成系统访问令牌（System Access Token），需具备读取日志与余额的权限。Token 仅保存在本地 <code>server/config.json</code>，不会上传。</p>
        </details>
        <details className={styles.faq}>
          <summary>成本单位如何换算？</summary>
          <p>OneAPI 默认 quota 单位 = 500000 = $1。前端按此规则换算为美元展示，如果你的中转站使用不同换算比例，可在 <code>src/api/client.js</code> 修改 <code>QUOTA_PER_DOLLAR</code> 常量。</p>
        </details>
        <details className={styles.faq}>
          <summary>缓存命中率是怎么计算的？</summary>
          <p>从最近 100 条消费日志中统计 <code>cache=true</code> 的占比。仅当中转站本身开启了缓存功能（如 prompt caching）时该指标才有意义。</p>
        </details>
        <details className={styles.faq}>
          <summary>数据多久更新一次？</summary>
          <p>后端默认 5 分钟内不重复请求中转站（避免被限流），可在设置页修改刷新间隔。前端可点击 Dashboard 右上角「刷新」按钮强制重新拉取。</p>
        </details>
        <details className={styles.faq}>
          <summary>未配置时显示的是什么数据？</summary>
          <p>若未发现 <code>server/config.json</code> 或未配置任何中转站，系统会使用内置 mock 数据演示 UI，此时顶部会显示「示例数据」徽标。</p>
        </details>
      </div>
    </div>
  )
}

export default Help
