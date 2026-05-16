// GitHub Actions 定时任务：查询到期提醒 → 推送微信消息
// 通过 WxPusher (https://wxpusher.zjiecode.com) 发送

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const APP_TOKEN = process.env.WXPUSHER_APP_TOKEN
const UID = process.env.WXPUSHER_UID

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !APP_TOKEN || !UID) {
  console.error('缺少环境变量')
  process.exit(1)
}

async function main() {
  // 1. 查询到期未通知的提醒
  const now = new Date().toISOString()
  const q = `${SUPABASE_URL}/rest/v1/reminders`
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }

  const res = await fetch(
    `${q}?remind_at=lte.${now}&notified=eq.false&done=eq.false&order=remind_at.asc`,
    { headers }
  )
  if (!res.ok) {
    console.error('查询失败', await res.text())
    process.exit(1)
  }
  const reminders = await res.json()

  if (reminders.length === 0) {
    console.log('没有到期的提醒')
    return
  }

  console.log(`发现 ${reminders.length} 条到期提醒`)

  // 2. 逐条推送微信消息
  for (const r of reminders) {
    console.log(`推送: ${r.title}`)

    const pushRes = await fetch('https://wxpusher.zjiecode.com/api/send/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appToken: APP_TOKEN,
        content: `⏰ 提醒：${r.title}\n时间：${new Date(r.remind_at).toLocaleString('zh-CN')}`,
        contentType: 1,       // 1=文字, 2=html, 3=markdown
        uids: [UID],
      }),
    })

    const pushData = await pushRes.json()
    if (pushData.code === 1000) {
      console.log(`✓ 已推送: ${r.title}`)
    } else {
      console.error(`✗ 推送失败: ${r.title}`, pushData)
    }

    // 3. 标记为已通知
    await fetch(`${q}?id=eq.${r.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ notified: true }),
    })
  }

  // 4. 处理重复提醒：给已完成的循环提醒创建下一次
  const repeatRes = await fetch(
    `${q}?done=eq.true&repeat_type=neq.none&order=remind_at.asc`,
    { headers }
  )
  if (repeatRes.ok) {
    const repeated = await repeatRes.json()
    for (const r of repeated) {
      const oldTime = new Date(r.remind_at)
      const next = new Date(oldTime)
      switch (r.repeat_type) {
        case 'daily':   next.setDate(next.getDate() + 1); break
        case 'weekly':  next.setDate(next.getDate() + 7); break
        case 'monthly': next.setMonth(next.getMonth() + 1); break
      }
      // 创建下一次提醒
      await fetch(q, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: r.title,
          remind_at: next.toISOString(),
          repeat_type: r.repeat_type,
        }),
      })
      console.log(`✓ 已创建重复提醒: ${r.title} → ${next.toLocaleString('zh-CN')}`)
      // 将原提醒的重复类型改为 none，避免重复生成
      await fetch(`${q}?id=eq.${r.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ repeat_type: 'none' }),
      })
    }
  }
}

main().catch(e => {
  console.error('脚本异常', e)
  process.exit(1)
})
