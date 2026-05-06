'use client'

import { useState, useCallback, useEffect } from 'react'

// ─── Type Definitions ─────────────────────────────────────────────────────────

type UserRole = 'hq_admin' | 'inspector' | 'store_manager'

type User = {
  id: number
  email: string
  name: string
  role: UserRole
  companyId: number
  storeId: number | null
}

type TaskStatus = 'PENDING_INSPECTION' | 'PENDING_RECTIFICATION' | 'PENDING_REVIEW' | 'CLOSED'

type Task = {
  id: number
  title: string
  description: string | null
  status: TaskStatus
  dueDate: string
  isOverdue: boolean
  store: { id: number; name: string; region: string | null }
  assignee: { id: number; name: string; email: string } | null
  creator: { id: number; name: string; email: string }
  _count: { inspectionItems: number; rectificationSubmissions: number }
}

type DashboardMetrics = {
  totalTasks: number
  closedTasks: number
  overdueTasks: number
  pendingRectification: number
  pendingReview: number
  completionRate: number
  overdueRate: number
}

type RectificationSubmission = {
  id: number
  note: string | null
  submittedAt: string
  submitter: { id: number; email: string; role: string }
  attachments: { id: number; s3Key: string; fileName: string }[]
}

type AuditLog = {
  id: number
  entityType: string
  entityId: number
  action: string
  beforeJson: unknown
  afterJson: unknown
  createdAt: string
  operator: { id: number; email: string; role: string }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING_INSPECTION: 'Pending Inspection',
  PENDING_RECTIFICATION: 'Pending Rectification',
  PENDING_REVIEW: 'Pending Review',
  CLOSED: 'Closed',
}

const STATUS_COLOR: Record<TaskStatus, string> = {
  PENDING_INSPECTION: '#1677ff',
  PENDING_RECTIFICATION: '#fa8c16',
  PENDING_REVIEW: '#722ed1',
  CLOSED: '#52c41a',
}

const ROLE_LABEL: Record<UserRole, string> = {
  hq_admin: 'HQ Admin',
  inspector: 'Inspector',
  store_manager: 'Store Manager',
}

type Tab = 'dashboard' | 'tasks' | 'audit'

// ─── Utility Functions ────────────────────────────────────────────────────────

function fmt(date: string) {
  return new Date(date).toLocaleDateString('en-US')
}

function fmtDatetime(date: string) {
  return new Date(date).toLocaleString('en-US')
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Home() {
  const [token, setToken] = useState('')
  const [refreshToken, setRefreshToken] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // main view
  const [tab, setTab] = useState<Tab>('dashboard')

  // task list
  const [tasks, setTasks] = useState<Task[]>([])
  const [filterStatus, setFilterStatus] = useState('')
  const [filterOverdue, setFilterOverdue] = useState(false)

  // dashboard
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)

  // audit logs
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage] = useState(1)

  // create task modal
  const [showCreateTask, setShowCreateTask] = useState(false)

  // rectification detail modal
  const [rectTaskId, setRectTaskId] = useState<number | null>(null)
  const [submissions, setSubmissions] = useState<RectificationSubmission[]>([])
  const [rectNote, setRectNote] = useState('Rectification completed, please review')
  const [rectFile, setRectFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  // image preview
  const [previewImage, setPreviewImage] = useState<string | null>(null)

  const isAuthed = Boolean(token && user)

  // ─── Auth ────────────────────────────────────────────────────────────────────

  async function login(email: string, password: string) {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Login failed')
      setToken(data.accessToken)
      setRefreshToken(data.refreshToken)
      setUser(data.user)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  async function logout() {
    // notify server to delete refresh token
    if (refreshToken) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => {})
    }
    setToken('')
    setRefreshToken('')
    setUser(null)
    setTasks([])
    setMetrics(null)
    setAuditLogs([])
    setError('')
    setTab('dashboard')
  }

  // when access token expires, use refresh token to get a new one automatically
  async function refreshAccessToken(): Promise<string | null> {
    if (!refreshToken) return null
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!res.ok) {
        // refresh token also expired, force logout
        logout()
        return null
      }
      const data = await res.json()
      setToken(data.accessToken)
      return data.accessToken
    } catch {
      return null
    }
  }

  // fetch wrapper with automatic token refresh
  async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    let currentToken = token
    const makeReq = (t: string) => fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${t}` },
    })

    let res = await makeReq(currentToken)

    // retry once with new token if access token expired
    if (res.status === 401) {
      const newToken = await refreshAccessToken()
      if (newToken) {
        res = await makeReq(newToken)
      }
    }
    return res
  }

  // ─── Data Loading ─────────────────────────────────────────────────────────────

  const loadTasks = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterStatus) params.set('status', filterStatus)
      if (filterOverdue) params.set('overdue', 'true')
      const res = await authFetch(`/api/tasks?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to load tasks')
      setTasks(data.tasks || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }, [token, refreshToken, filterStatus, filterOverdue])

  const loadMetrics = useCallback(async () => {
    try {
      const res = await authFetch('/api/dashboard/metrics')
      const data = await res.json()
      if (res.ok) setMetrics(data.summary)
    } catch {
      // silent fail
    }
  }, [token, refreshToken])

  const loadAuditLogs = useCallback(async (page = 1) => {
    setError('')
    setLoading(true)
    try {
      const res = await authFetch(`/api/audit-logs?page=${page}&pageSize=15`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to load audit logs')
      setAuditLogs(data.data || [])
      setAuditTotal(data.total || 0)
      setAuditPage(page)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit logs')
    } finally {
      setLoading(false)
    }
  }, [token, refreshToken])

  // auto-load after login
  useEffect(() => {
    if (!isAuthed) return
    loadMetrics()
  }, [isAuthed, loadMetrics])

  useEffect(() => {
    if (!isAuthed || tab !== 'tasks') return
    loadTasks()
  }, [isAuthed, tab, loadTasks])

  useEffect(() => {
    if (!isAuthed || tab !== 'audit') return
    loadAuditLogs(1)
  }, [isAuthed, tab, loadAuditLogs])

  // ─── Status Transitions ───────────────────────────────────────────────────────

  async function changeStatus(taskId: number, status: TaskStatus) {
    setError('')
    setLoading(true)
    try {
      const res = await authFetch(`/api/tasks/${taskId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Status update failed')
      await loadTasks()
      await loadMetrics()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status update failed')
    } finally {
      setLoading(false)
    }
  }

  // ─── Rectification Submission ─────────────────────────────────────────────────

  async function openRectification(taskId: number) {
    setRectTaskId(taskId)
    setRectNote('Rectification completed, please review')
    setRectFile(null)
    setSubmissions([])
    // load existing rectification records
    try {
      const res = await authFetch(`/api/tasks/${taskId}/rectifications`)
      const data = await res.json()
      if (res.ok) setSubmissions(data.submissions || [])
    } catch {
      // silent
    }
  }

  async function submitRectification() {
    if (rectTaskId === null) return
    setError('')
    setUploading(true)
    try {
      const s3Keys: string[] = []

      // if file present, upload to S3 first
      if (rectFile) {
        const presignRes = await authFetch('/api/files/presign-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: rectTaskId,
            fileName: rectFile.name,
            mimeType: rectFile.type || 'application/octet-stream',
            size: rectFile.size,
          }),
        })
        const presignData = await presignRes.json()
        console.log('[presign-upload] status:', presignRes.status, 'body:', presignData)
        if (!presignRes.ok) throw new Error(presignData?.error || 'Failed to get upload URL')

        // PUT to S3
        console.log('[s3 upload] PUT to:', presignData.uploadUrl?.slice(0, 80) + '...', 'file size:', rectFile.size)
        const uploadRes = await fetch(presignData.uploadUrl, {
          method: 'PUT',
          body: rectFile,
          headers: { 'Content-Type': rectFile.type || 'application/octet-stream' },
        })
        console.log('[s3 upload] response status:', uploadRes.status, uploadRes.statusText)
        if (!uploadRes.ok) throw new Error('File upload to S3 failed')
        s3Keys.push(presignData.s3Key)
      }

      // submit rectification
      const res = await authFetch(`/api/tasks/${rectTaskId}/rectifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: rectNote, s3Keys }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to submit rectification')

      setRectTaskId(null)
      await loadTasks()
      await loadMetrics()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit rectification')
    } finally {
      setUploading(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  if (!isAuthed) {
    return <LoginPage onLogin={login} loading={loading} error={error} />
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#f5f6fa' }}>
      {/* top navigation */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e8e8e8', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 0, height: 56 }}>
        <span style={{ fontWeight: 700, fontSize: 18, color: '#1677ff', marginRight: 32 }}>🔍 Inspection Platform</span>
        <nav style={{ display: 'flex', gap: 0, flex: 1 }}>
          {(['dashboard', 'tasks', ...(user?.role === 'hq_admin' ? ['audit'] : [])] as Tab[]).map((t) => {
            const labels: Record<Tab, string> = { dashboard: 'Dashboard', tasks: 'Tasks', audit: 'Audit Logs' }
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  ...navBtnStyle,
                  color: tab === t ? '#1677ff' : '#595959',
                  borderBottom: tab === t ? '2px solid #1677ff' : '2px solid transparent',
                  fontWeight: tab === t ? 600 : 400,
                }}
              >
                {labels[t]}
              </button>
            )
          })}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#595959' }}>
            <strong>{user?.name}</strong>（{ROLE_LABEL[user!.role]}）
          </span>
          <button onClick={logout} style={outlineBtnStyle}>Logout</button>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
        {error && (
          <div style={{ marginBottom: 16, color: '#cf1322', background: '#fff1f0', border: '1px solid #ffa39e', padding: '10px 16px', borderRadius: 6 }}>
            {error}
          </div>
        )}

        {tab === 'dashboard' && (
          <DashboardTab metrics={metrics} onRefresh={loadMetrics} />
        )}

        {tab === 'tasks' && (
          <TasksTab
            tasks={tasks}
            user={user!}
            loading={loading}
            filterStatus={filterStatus}
            filterOverdue={filterOverdue}
            onFilterStatus={setFilterStatus}
            onFilterOverdue={setFilterOverdue}
            onRefresh={() => loadTasks()}
            onShowCreate={() => setShowCreateTask(true)}
            onChangeStatus={changeStatus}
            onOpenRectification={openRectification}
          />
        )}

        {tab === 'audit' && (
          <AuditTab
            logs={auditLogs}
            total={auditTotal}
            page={auditPage}
            loading={loading}
            onPageChange={(p) => loadAuditLogs(p)}
            onRefresh={() => loadAuditLogs(1)}
          />
        )}
      </main>

      {/* create task modal */}
      {showCreateTask && (
        <CreateTaskModal
          token={token}
          onClose={() => setShowCreateTask(false)}
          onCreated={async () => {
            setShowCreateTask(false)
            await loadTasks()
            await loadMetrics()
          }}
        />
      )}

      {/* rectification modal */}
      {rectTaskId !== null && (
        <RectificationModal
          taskId={rectTaskId}
          user={user!}
          submissions={submissions}
          note={rectNote}
          file={rectFile}
          uploading={uploading}
          onFetch={authFetch}
          onNoteChange={setRectNote}
          onFileChange={setRectFile}
          onClose={() => setRectTaskId(null)}
          onSubmit={submitRectification}
          onPreview={setPreviewImage}
        />
      )}

      {/* image preview */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            padding: 24,
            cursor: 'pointer',
          }}
        >
          <img
            src={previewImage}
            alt="Preview"
            style={{ maxWidth: '90%', maxHeight: '90%', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setPreviewImage(null)}
            style={{
              position: 'absolute',
              top: 24,
              right: 24,
              background: 'rgba(255,255,255,0.9)',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 16,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Login Page ───────────────────────────────────────────────────────────────

function LoginPage({ onLogin, loading, error }: {
  onLogin: (email: string, password: string) => void; loading: boolean; error: string
}) {
  const [email, setEmail] = useState('admin@test.com')
  const [password, setPassword] = useState('password123')
  return (
    <div style={{ minHeight: '100vh', background: '#f5f6fa', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 40, width: '100%', maxWidth: 480, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <h1 style={{ marginTop: 0, marginBottom: 4, fontSize: 22 }}>🔍 Store Inspection Platform</h1>
        <p style={{ color: '#8c8c8c', marginBottom: 20, marginTop: 0 }}>Please log in to continue</p>

        {/* Demo notice */}
        <div style={{ background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 6, padding: 12, marginBottom: 20, fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600, color: '#0958d9', marginBottom: 6 }}>📌 Demo Application</div>
          <div style={{ color: '#003eb3' }}>This is a demonstration of a multi-tenant store inspection management system.</div>
        </div>

        {error && (
          <div style={{ marginBottom: 16, color: '#cf1322', background: '#fff1f0', border: '1px solid #ffa39e', padding: '8px 12px', borderRadius: 6, fontSize: 14 }}>
            {error}
          </div>
        )}
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <div style={labelStyle}>Email</div>
            <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" />
          </div>
          <div>
            <div style={labelStyle}>Password</div>
            <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onLogin(email, password)} />
          </div>
          <button onClick={() => onLogin(email, password)} disabled={loading} style={{ ...primaryBtnStyle, width: '100%', padding: '10px 0', marginTop: 4 }}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </div>

        {/* Test accounts and role descriptions */}
        <div style={{ marginTop: 24, fontSize: 13, color: '#595959', lineHeight: 1.7 }}>
          <div style={{ fontWeight: 600, marginBottom: 10, color: '#262626' }}>Test Accounts (password: password123)</div>

          <div style={{ marginBottom: 12, paddingLeft: 12, borderLeft: '3px solid #1677ff' }}>
            <div style={{ fontWeight: 500, color: '#1677ff' }}>admin@test.com — HQ Admin</div>
            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 2 }}>• Create & manage tasks • View all data • Access audit logs • Approve/reject rectifications</div>
          </div>

          <div style={{ marginBottom: 12, paddingLeft: 12, borderLeft: '3px solid #52c41a' }}>
            <div style={{ fontWeight: 500, color: '#52c41a' }}>inspector@test.com — Inspector</div>
            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 2 }}>• Create tasks • Submit inspection results • Approve/reject rectifications</div>
          </div>

          <div style={{ paddingLeft: 12, borderLeft: '3px solid #fa8c16' }}>
            <div style={{ fontWeight: 500, color: '#fa8c16' }}>manager@test.com — Store Manager</div>
            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 2 }}>• View own store tasks • Submit rectifications with attachments</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Dashboard Tab ─────────────────────────────────────────────────────────────

function DashboardTab({ metrics, onRefresh }: { metrics: DashboardMetrics | null; onRefresh: () => void }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Operations Dashboard</h2>
        <button onClick={onRefresh} style={outlineBtnStyle}>Refresh</button>
      </div>
      {!metrics ? (
        <div style={cardStyle}>Loading...</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
            <MetricCard label="Total Tasks" value={metrics.totalTasks} color="#1677ff" />
            <MetricCard label="Closed" value={metrics.closedTasks} color="#52c41a" />
            <MetricCard label="Completion Rate" value={`${metrics.completionRate}%`} color="#13c2c2" />
            <MetricCard label="Overdue Tasks" value={metrics.overdueTasks} color="#cf1322" />
            <MetricCard label="Overdue Rate" value={`${metrics.overdueRate}%`} color="#fa541c" />
            <MetricCard label="Pending Rectification" value={metrics.pendingRectification} color="#fa8c16" />
            <MetricCard label="Pending Review" value={metrics.pendingReview} color="#722ed1" />
          </div>

          {/* progress bars */}
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0, marginBottom: 16 }}>Task Completion Progress</h3>
            <ProgressBar label="Completed" value={metrics.completionRate} color="#52c41a" />
            <ProgressBar label="Overdue Rate" value={metrics.overdueRate} color="#cf1322" />
          </div>
        </>
      )}
    </div>
  )
}

function MetricCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ ...cardStyle, textAlign: 'center', padding: '20px 16px' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 4 }}>{label}</div>
    </div>
  )
}

function ProgressBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
        <span>{label}</span><span style={{ color }}>{value}%</span>
      </div>
      <div style={{ background: '#f0f0f0', borderRadius: 4, height: 8, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, background: color, height: '100%', borderRadius: 4, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

// ─── Tasks Tab ────────────────────────────────────────────────────────────────

function TasksTab({ tasks, user, loading, filterStatus, filterOverdue, onFilterStatus, onFilterOverdue, onRefresh, onShowCreate, onChangeStatus, onOpenRectification }: {
  tasks: Task[]; user: User; loading: boolean
  filterStatus: string; filterOverdue: boolean
  onFilterStatus: (v: string) => void; onFilterOverdue: (v: boolean) => void
  onRefresh: () => void; onShowCreate: () => void
  onChangeStatus: (id: number, s: TaskStatus) => void
  onOpenRectification: (id: number) => void
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Task Management ({tasks.length})</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* filters */}
          <select
            value={filterStatus}
            onChange={(e) => onFilterStatus(e.target.value)}
            style={selectStyle}
          >
            <option value="">All Statuses</option>
            <option value="PENDING_INSPECTION">Pending Inspection</option>
            <option value="PENDING_RECTIFICATION">Pending Rectification</option>
            <option value="PENDING_REVIEW">Pending Review</option>
            <option value="CLOSED">Closed</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={filterOverdue} onChange={(e) => onFilterOverdue(e.target.checked)} />
            Overdue only
          </label>
          <button onClick={onRefresh} disabled={loading} style={outlineBtnStyle}>Refresh</button>
          {(user.role === 'hq_admin' || user.role === 'inspector') && (
            <button onClick={onShowCreate} style={primaryBtnStyle}>+ Create Task</button>
          )}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['ID', 'Title', 'Store', 'Assignee', 'Due Date', 'Status', 'Items', 'Actions'].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#8c8c8c', padding: 32 }}>No tasks found</td></tr>
              )}
              {tasks.map((task) => (
                <tr key={task.id} style={{ background: task.isOverdue && task.status !== 'CLOSED' ? '#fff7e6' : undefined }}>
                  <td style={tdStyle}>{task.id}</td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 500 }}>{task.title}</div>
                    {task.description && <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 2 }}>{task.description}</div>}
                    {task.isOverdue && task.status !== 'CLOSED' && (
                      <span style={{ fontSize: 11, color: '#cf1322', background: '#fff1f0', padding: '1px 6px', borderRadius: 3, marginTop: 4, display: 'inline-block' }}>Overdue</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <div>{task.store?.name || '-'}</div>
                    {task.store?.region && <div style={{ fontSize: 12, color: '#8c8c8c' }}>{task.store.region}</div>}
                  </td>
                  <td style={tdStyle}>{task.assignee?.name || '-'}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmt(task.dueDate)}</td>
                  <td style={tdStyle}>
                    <span style={{ ...badgeStyle, background: STATUS_COLOR[task.status] + '20', color: STATUS_COLOR[task.status], border: `1px solid ${STATUS_COLOR[task.status]}40` }}>
                      {STATUS_LABEL[task.status]}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{task._count.inspectionItems}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {task.status === 'PENDING_INSPECTION' && (user.role === 'hq_admin' || user.role === 'inspector') && (
                        <button onClick={() => onChangeStatus(task.id, 'PENDING_RECTIFICATION')} disabled={loading} style={smallBtnStyle}>Submit Inspection</button>
                      )}
                      {task.status === 'PENDING_RECTIFICATION' && user.role === 'store_manager' && (
                        <button onClick={() => onOpenRectification(task.id)} disabled={loading} style={{ ...smallBtnStyle, background: '#fa8c16' }}>Submit Rectification</button>
                      )}
                      {task.status === 'PENDING_REVIEW' && (user.role === 'hq_admin' || user.role === 'inspector') && (
                        <>
                          <button onClick={() => onChangeStatus(task.id, 'CLOSED')} disabled={loading} style={{ ...smallBtnStyle, background: '#52c41a' }}>Approve</button>
                          <button onClick={() => onChangeStatus(task.id, 'PENDING_RECTIFICATION')} disabled={loading} style={{ ...smallBtnStyle, background: '#ff4d4f' }}>Reject</button>
                        </>
                      )}
                      {/* any role can view rectification records */}
                      {task._count.rectificationSubmissions > 0 && (
                        <button onClick={() => onOpenRectification(task.id)} style={{ ...smallBtnStyle, background: '#722ed1' }}>Rectifications ({task._count.rectificationSubmissions})</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Audit Logs Tab ────────────────────────────────────────────────────────────

function AuditTab({ logs, total, page, loading, onPageChange, onRefresh }: {
  logs: AuditLog[]; total: number; page: number; loading: boolean
  onPageChange: (p: number) => void; onRefresh: () => void
}) {
  const totalPages = Math.ceil(total / 15)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Audit Logs ({total} total)</h2>
        <button onClick={onRefresh} disabled={loading} style={outlineBtnStyle}>Refresh</button>
      </div>
      <div style={cardStyle}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['ID', 'Entity Type', 'Entity ID', 'Action', 'Operator', 'Time'].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && !loading && (
                <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: '#8c8c8c', padding: 32 }}>No logs found</td></tr>
              )}
              {logs.map((log) => (
                <tr key={log.id}>
                  <td style={tdStyle}>{log.id}</td>
                  <td style={tdStyle}>{log.entityType}</td>
                  <td style={tdStyle}>{log.entityId}</td>
                  <td style={tdStyle}><span style={{ ...badgeStyle, background: '#e6f4ff', color: '#1677ff', border: '1px solid #91caff' }}>{log.action}</span></td>
                  <td style={tdStyle}>
                    <div>{log.operator.email}</div>
                    <div style={{ fontSize: 12, color: '#8c8c8c' }}>{log.operator.role}</div>
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontSize: 13 }}>{fmtDatetime(log.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            <button onClick={() => onPageChange(page - 1)} disabled={page <= 1 || loading} style={outlineBtnStyle}>Previous</button>
            <span style={{ lineHeight: '32px', fontSize: 14, color: '#595959' }}>Page {page} / {totalPages}</span>
            <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages || loading} style={outlineBtnStyle}>Next</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Create Task Modal ─────────────────────────────────────────────────────────

function CreateTaskModal({ token, onClose, onCreated }: {
  token: string; onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({
    storeId: '',
    title: '',
    description: '',
    assigneeId: '',
    dueDate: '',
  })
  const [items, setItems] = useState([{ itemName: '' }])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [stores, setStores] = useState<{ id: number; name: string; region: string | null }[]>([])
  const [users, setUsers] = useState<{ id: number; name: string; email: string; role: string }[]>([])
  const [loading, setLoading] = useState(true)

  // Load stores and users on mount
  useEffect(() => {
    async function loadOptions() {
      try {
        const [storesRes, usersRes] = await Promise.all([
          fetch('/api/stores', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } })
        ])
        if (storesRes.ok) {
          const storesData = await storesRes.json()
          setStores(storesData.stores || storesData || [])
        }
        if (usersRes.ok) {
          const usersData = await usersRes.json()
          // Filter to only show inspectors and admins as assignees
          const assignableUsers = (usersData.users || usersData || []).filter(
            (u: User) => u.role === 'inspector' || u.role === 'hq_admin'
          )
          setUsers(assignableUsers)
        }
      } catch (e) {
        console.error('Failed to load options:', e)
      } finally {
        setLoading(false)
      }
    }
    loadOptions()
  }, [token])

  function setField(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function addItem() {
    setItems((prev) => [...prev, { itemName: '' }])
  }

  function setItem(idx: number, value: string) {
    setItems((prev) => prev.map((it, i) => i === idx ? { itemName: value } : it))
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  async function submit() {
    setErr('')
    if (!form.storeId || !form.title || !form.assigneeId || !form.dueDate) {
      setErr('Please fill in all required fields')
      return
    }
    const validItems = items.filter((i) => i.itemName.trim())
    if (validItems.length === 0) {
      setErr('At least one inspection item is required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          storeId: parseInt(form.storeId),
          title: form.title,
          description: form.description || undefined,
          assigneeId: parseInt(form.assigneeId),
          dueDate: form.dueDate,
          items: validItems,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(JSON.stringify(data?.error) || 'Create failed')
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Create Inspection Task" onClose={onClose}>
      {err && <div style={{ color: '#cf1322', background: '#fff1f0', border: '1px solid #ffa39e', padding: '8px 12px', borderRadius: 6, marginBottom: 14, fontSize: 14 }}>{err}</div>}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '20px 0', color: '#8c8c8c' }}>Loading options...</div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <FormField label="Store *">
            <select
              style={selectStyle}
              value={form.storeId}
              onChange={(e) => setField('storeId', e.target.value)}
            >
              <option value="">Select a store</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}{store.region ? ` (${store.region})` : ''}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Task Title *">
            <input style={inputStyle} value={form.title} onChange={(e) => setField('title', e.target.value)} placeholder="e.g. January 2024 Routine Inspection" />
          </FormField>
          <FormField label="Task Description">
            <textarea style={{ ...inputStyle, height: 68, resize: 'vertical' }} value={form.description} onChange={(e) => setField('description', e.target.value)} placeholder="Optional" />
          </FormField>
          <FormField label="Assignee *">
            <select
              style={selectStyle}
              value={form.assigneeId}
              onChange={(e) => setField('assigneeId', e.target.value)}
            >
              <option value="">Select an assignee</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.email})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Due Date *">
            <input style={inputStyle} type="date" value={form.dueDate} onChange={(e) => setField('dueDate', e.target.value)} />
          </FormField>

          <div>
            <div style={{ ...labelStyle, marginBottom: 8 }}>Inspection Items (at least 1)</div>
            {items.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  value={item.itemName}
                  onChange={(e) => setItem(idx, e.target.value)}
                  placeholder={`Item ${idx + 1}`}
                />
                {items.length > 1 && (
                  <button onClick={() => removeItem(idx)} style={{ ...outlineBtnStyle, color: '#ff4d4f', borderColor: '#ff4d4f', padding: '4px 10px' }}>✕</button>
                )}
              </div>
            ))}
            <button onClick={addItem} style={outlineBtnStyle}>+ Add Item</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
        <button onClick={onClose} style={outlineBtnStyle}>Cancel</button>
        <button onClick={submit} disabled={saving} style={primaryBtnStyle}>{saving ? 'Creating...' : 'Create Task'}</button>
      </div>
    </Modal>
  )
}

// ─── Rectification Modal ──────────────────────────────────────────────────────

function RectificationModal({ taskId, user, submissions, note, file, uploading, onFetch, onNoteChange, onFileChange, onClose, onSubmit, onPreview }: {
  taskId: number; user: User
  submissions: RectificationSubmission[]
  note: string; file: File | null; uploading: boolean
  onFetch: (url: string, options?: RequestInit) => Promise<Response>
  onNoteChange: (v: string) => void
  onFileChange: (f: File | null) => void
  onClose: () => void
  onSubmit: () => void
  onPreview: (url: string) => void
}) {
  const canSubmit = user.role === 'store_manager'
  return (
    <Modal title={`Task #${taskId} Rectification Records`} onClose={onClose} width={560}>
      {/* historical rectification records */}
      {submissions.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>History ({submissions.length} submissions)</div>
          {submissions.map((sub) => (
            <div key={sub.id} style={{ background: '#f5f6fa', borderRadius: 6, padding: '10px 14px', marginBottom: 8 }}>
              <div style={{ fontSize: 13, color: '#595959', marginBottom: 4 }}>
                {sub.submitter.email} · {fmtDatetime(sub.submittedAt)}
              </div>
              <div style={{ fontSize: 14 }}>{sub.note || '(no note)'}</div>
              {sub.attachments.length > 0 && (
                <div style={{ fontSize: 13, marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {sub.attachments.map((att) => {
                    const isImage = att.fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i)
                    return (
                      <button
                        key={att.id}
                        onClick={async () => {
                          if (isImage) {
                            try {
                              const res = await onFetch(`/api/files/${att.id}/presign-download`)
                              if (!res.ok) throw new Error('Failed to get preview URL')
                              const { downloadUrl } = await res.json()
                              onPreview(downloadUrl)
                            } catch (e) {
                              alert(e instanceof Error ? e.message : 'Preview failed')
                            }
                          } else {
                            window.open(`/api/files/${att.id}/presign-download`, '_blank')
                          }
                        }}
                        style={{
                          background: isImage ? '#e6f4ff' : '#f5f6fa',
                          border: isImage ? '1px solid #91caff' : '1px solid #d9d9d9',
                          borderRadius: 4,
                          padding: '4px 8px',
                          fontSize: 13,
                          color: isImage ? '#1677ff' : '#595959',
                          cursor: 'pointer',
                        }}
                      >
                        {isImage ? '🖼️' : '📎'} {att.fileName}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* submit new rectification (store_manager only) */}
      {canSubmit && (
        <div>
          <div style={{ ...labelStyle, marginBottom: 8 }}>Submit New Rectification</div>
          <div style={{ display: 'grid', gap: 12 }}>
            <FormField label="Rectification Note">
              <textarea
                style={{ ...inputStyle, height: 80, resize: 'vertical' }}
                value={note}
                onChange={(e) => onNoteChange(e.target.value)}
              />
            </FormField>
            <FormField label="Attachment (optional, max 10MB)">
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => onFileChange(e.target.files?.[0] || null)}
                style={{ fontSize: 14 }}
              />
              {file && <div style={{ fontSize: 13, color: '#52c41a', marginTop: 4 }}>Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)</div>}
            </FormField>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={onClose} style={outlineBtnStyle}>Close</button>
            <button onClick={onSubmit} disabled={uploading} style={{ ...primaryBtnStyle, background: '#fa8c16' }}>
              {uploading ? 'Submitting...' : 'Submit Rectification'}
            </button>
          </div>
        </div>
      )}

      {!canSubmit && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={onClose} style={outlineBtnStyle}>Close</button>
        </div>
      )}
    </Modal>
  )
}

// ─── Common Components ────────────────────────────────────────────────────────

function Modal({ title, onClose, children, width = 480 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 10, width: '100%', maxWidth: width, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #f0f0f0' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#8c8c8c', lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  )
}

// ─── Style Constants ──────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: 20,
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  borderBottom: '2px solid #f0f0f0',
  padding: '10px 12px',
  whiteSpace: 'nowrap',
  fontSize: 13,
  color: '#595959',
  fontWeight: 600,
}

const tdStyle: React.CSSProperties = {
  borderBottom: '1px solid #f5f6fa',
  padding: '10px 12px',
  verticalAlign: 'top',
  fontSize: 14,
}

const primaryBtnStyle: React.CSSProperties = {
  background: '#1677ff',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '7px 16px',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500,
}

const outlineBtnStyle: React.CSSProperties = {
  background: '#fff',
  color: '#595959',
  border: '1px solid #d9d9d9',
  borderRadius: 6,
  padding: '5px 14px',
  cursor: 'pointer',
  fontSize: 14,
}

const smallBtnStyle: React.CSSProperties = {
  background: '#1677ff',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  padding: '3px 10px',
  cursor: 'pointer',
  fontSize: 12,
}

const navBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: '0 16px',
  height: 56,
  cursor: 'pointer',
  fontSize: 15,
}

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 500,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  border: '1px solid #d9d9d9',
  borderRadius: 6,
  fontSize: 14,
  boxSizing: 'border-box',
  outline: 'none',
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#595959',
  fontWeight: 500,
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  width: '100%',
  padding: '7px 10px',
}
