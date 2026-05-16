// 使用 Supabase REST API（不需要客户端库，直接用 fetch）

// --- API Helper ---
function supabase(path, options = {}) {
  const url = SUPABASE_URL + '/rest/v1/' + path
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    ...options.headers,
  }
  if (options.prefer) headers.Prefer = options.prefer
  return fetch(url, { ...options, headers })
}

// --- State ---
let reminders = []
let filter = 'pending'
let editingId = null

// --- DOM refs ---
const $ = s => document.querySelector(s)
const list = $('#reminderList')
const emptyState = $('#emptyState')
const tabs = document.querySelectorAll('.tab')
const formOverlay = $('#formOverlay')
const formTitle = $('#formTitle')
const submitBtn = $('#submitBtn')
const reminderForm = $('#reminderForm')
const titleInput = $('#titleInput')
const timeInput = $('#timeInput')
const repeatSelect = $('#repeatSelect')

// 弹窗 refs
const modal = $('#reminderModal')
const modalTitle = $('#modalTitle')
const modalBody = $('#modalBody')
const modalConfirm = $('#modalConfirm')

// --- Init ---
;(async function init() {
  setDefaultTime()
  await loadReminders()
  setupEventListeners()
  checkDueReminders()            // 立即检查一次
  setInterval(checkDueReminders, 15000)  // 每15秒轮询
  registerSW()
})()

function setDefaultTime() {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  timeInput.value = d.toISOString().slice(0, 16)
}

// --- Data ---
async function loadReminders() {
  const res = await supabase('reminders', {
    headers: { Prefer: 'count=exact' },
  })
  if (!res.ok) { showToast('加载失败'); return }
  reminders = await res.json()
  render()
}

async function createReminder(title, remindAt, repeatType) {
  const res = await supabase('reminders', {
    method: 'POST',
    prefer: 'return=representation',
    body: JSON.stringify({ title, remind_at: remindAt, repeat_type: repeatType }),
  })
  if (!res.ok) { showToast('创建失败'); return }
  const data = await res.json()
  reminders.unshift(data[0])
  render()
  showToast('提醒已创建')
}

async function toggleDone(id, currentDone) {
  const res = await supabase(`reminders?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ done: !currentDone }),
  })
  if (!res.ok) { showToast('操作失败'); return }
  const r = reminders.find(x => x.id === id)
  if (r) r.done = !currentDone
  render()
}

async function deleteReminder(id) {
  if (!confirm('确定删除这条提醒？')) return
  const res = await supabase(`reminders?id=eq.${id}`, { method: 'DELETE' })
  if (!res.ok) { showToast('删除失败'); return }
  reminders = reminders.filter(x => x.id !== id)
  render()
}

async function updateReminder(id, title, remindAt, repeatType) {
  const res = await supabase(`reminders?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title, remind_at: remindAt, repeat_type: repeatType, notified: false }),
  })
  if (!res.ok) { showToast('更新失败'); return }
  const r = reminders.find(x => x.id === id)
  if (r) Object.assign(r, { title, remind_at: remindAt, repeat_type: repeatType, notified: false })
  render()
  showToast('提醒已更新')
}

// --- Render ---
function render() {
  const filtered = reminders.filter(r => {
    if (filter === 'pending') return !r.done
    return r.done
  })

  if (filtered.length === 0) {
    list.classList.add('hidden')
    emptyState.classList.remove('hidden')
    return
  }

  list.classList.remove('hidden')
  emptyState.classList.add('hidden')
  list.innerHTML = filtered.map(r => renderCard(r)).join('')
}

function renderCard(r) {
  const time = new Date(r.remind_at)
  const now = new Date()
  const isOverdue = !r.done && time < now
  const timeStr = formatTime(time)
  const repeatLabels = { none: '', daily: '每天', weekly: '每周', monthly: '每月' }
  const repeatLabel = repeatLabels[r.repeat_type] || ''

  return `
    <div class="card ${r.done ? 'card-done' : ''} ${isOverdue ? 'card-overdue' : ''}" data-id="${r.id}">
      <div class="card-check ${r.done ? 'done' : ''}" data-action="toggle">${r.done ? '✓' : ''}</div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(r.title)}</div>
        <div class="card-meta">
          <span class="card-time">${timeStr}</span>
          ${repeatLabel ? `<span class="badge">${repeatLabel}</span>` : ''}
        </div>
      </div>
      <button class="card-delete" data-action="delete" aria-label="删除">✕</button>
    </div>
  `
}

function formatTime(d) {
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const pad = n => String(n).padStart(2, '0')

  const datePart = d.toDateString() === today.toDateString() ? '今天' :
                   d.toDateString() === tomorrow.toDateString() ? '明天' :
                   `${d.getMonth()+1}/${d.getDate()}`

  return `${datePart} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function escapeHtml(s) {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

// --- 播放提示音 ---
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8)
    osc.start()
    osc.stop(ctx.currentTime + 0.8)
  } catch (e) { /* 忽略音频错误 */ }
}

// --- 弹出提醒弹窗（手动关闭） ---
function showReminderModal(title, body) {
  modalTitle.textContent = title
  modalBody.textContent = body
  modal.classList.remove('hidden')
  playBeep()
  // 震动提醒（手机端）
  if (navigator.vibrate) navigator.vibrate([200, 100, 200])
}

// --- 后台也试着发通知（如能发则发） ---
function tryNotify(title, body, tag) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, { body, icon: '/icons/icon-192.svg', tag })
      })
    }
  } catch (_) {}
}

// --- Check due reminders ---
async function checkDueReminders() {
  const due = reminders.filter(r =>
    !r.done && !r.notified && new Date(r.remind_at) <= new Date()
  )
  if (due.length === 0) { await handleRepeating(); return }

  for (const r of due) {
    console.log('[提醒] 到期:', r.title)
    showReminderModal('⏰ 提醒', r.title)
    tryNotify('⏰ 提醒', r.title, r.id)
    // 标记已通知
    const ok = await supabase(`reminders?id=eq.${r.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ notified: true }),
    })
    if (ok.ok) r.notified = true
  }
  render()
  await handleRepeating()
}

// 弹窗确认按钮
modalConfirm.addEventListener('click', () => {
  modal.classList.add('hidden')
})

async function handleRepeating() {
  for (const r of reminders) {
    if (r.done && r.repeat_type !== 'none') {
      const oldTime = new Date(r.remind_at)
      const now = new Date()
      let next = new Date(oldTime)
      switch (r.repeat_type) {
        case 'daily':   next.setDate(next.getDate() + 1); break
        case 'weekly':  next.setDate(next.getDate() + 7); break
        case 'monthly': next.setMonth(next.getMonth() + 1); break
      }
      if (next <= now) {
        // 生成下一次提醒
        const res = await supabase('reminders', {
          method: 'POST',
          prefer: 'return=representation',
          body: JSON.stringify({ title: r.title, remind_at: next.toISOString(), repeat_type: r.repeat_type }),
        })
        if (res.ok) {
          const data = await res.json()
          reminders.unshift(data[0])
          // 把原来的提醒设为不重复
          await supabase(`reminders?id=eq.${r.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ repeat_type: 'none' }),
          })
          r.repeat_type = 'none'
        }
      }
    }
  }
  render()
}

// --- Events ---
function setupEventListeners() {
  // Tabs
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      filter = tab.dataset.filter
      render()
    })
  })

  // Open form
  $('#addBtn').addEventListener('click', () => openForm())
  $('#formClose').addEventListener('click', closeForm)
  formOverlay.addEventListener('click', e => {
    if (e.target === formOverlay) closeForm()
  })

  // Submit form
  reminderForm.addEventListener('submit', e => {
    e.preventDefault()
    const title = titleInput.value.trim()
    if (!title) return
    const time = new Date(timeInput.value)
    if (isNaN(time.getTime())) { showToast('请选择有效时间'); return }
    const repeat = repeatSelect.value

    if (editingId) {
      updateReminder(editingId, title, time.toISOString(), repeat)
    } else {
      createReminder(title, time.toISOString(), repeat)
    }
    closeForm()
  })

  // 测试弹窗按钮
  $('#testNotifBtn').addEventListener('click', () => {
    showReminderModal('🔔 测试弹窗', '弹窗功能正常！\n点击"我知道了"关闭')
  })

  // Click on list items (event delegation)
  list.addEventListener('click', e => {
    const card = e.target.closest('.card')
    if (!card) return
    const id = card.dataset.id
    const action = e.target.dataset.action
    if (action === 'toggle') {
      const r = reminders.find(x => x.id === id)
      if (r) toggleDone(id, r.done)
    } else if (action === 'delete') {
      deleteReminder(id)
    }
  })
}

function openForm(r) {
  editingId = r ? r.id : null
  formTitle.textContent = r ? '编辑提醒' : '新建提醒'
  submitBtn.textContent = r ? '保存' : '添加提醒'
  if (r) {
    titleInput.value = r.title
    timeInput.value = new Date(r.remind_at).toISOString().slice(0, 16)
    repeatSelect.value = r.repeat_type
  } else {
    titleInput.value = ''
    setDefaultTime()
    repeatSelect.value = 'none'
  }
  formOverlay.classList.remove('hidden')
  titleInput.focus()
}

function closeForm() {
  formOverlay.classList.add('hidden')
  editingId = null
}

// --- Service Worker ---
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(() => {
      console.log('[SW] 注册成功')
    }).catch(e => {
      console.error('[SW] 注册失败:', e)
    })
  }
  // 请求通知权限
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(p => {
      console.log('[通知] 权限:', p)
      updateNotifStatus()
    })
  }
}

// --- Toast ---
function showToast(msg) {
  const old = document.querySelector('.toast')
  if (old) old.remove()
  const div = document.createElement('div')
  div.className = 'toast'
  div.textContent = msg
  document.body.appendChild(div)
  setTimeout(() => div.remove(), 2000)
}
