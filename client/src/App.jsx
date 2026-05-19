import { useEffect, useMemo, useRef, useState } from 'react';
import logo from './logo.png';
import {
  fetchDashboard,
  fetchLeaves,
  fetchUsers,
  createLeaveRequest,
  createUser,
  updateUser,
  deleteUser,
  uploadProfilePhoto,
  uploadHealthReport,
  approveLeave,
  rejectLeave,
  updateLeave,
  cancelLeave,
  login,
  fetchMe,
  setAuthToken
} from './api.js';

function App() {
  const [users, setUsers] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [leaves, setLeaves] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState(null);
  const [formState, setFormState] = useState({ type: 'annual', startDate: '', endDate: '', reason: '' });
  const [photoFile, setPhotoFile] = useState(null);
  const [reportFile, setReportFile] = useState(null);
  const [uploadedReport, setUploadedReport] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [approvalComments, setApprovalComments] = useState({});
  const [authForm, setAuthForm] = useState({ email: '', password: '' });
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'operator',
    department: 'Kesim',
    graduation: '',
    startDate: '',
    phone: '',
    notes: ''
  });
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [editEmployeeForm, setEditEmployeeForm] = useState(null);
  const [reportFilters, setReportFilters] = useState({ fromDate: '', toDate: '', status: '', type: '', reporterName: '' });
  const [reportSort, setReportSort] = useState('');
  const [dashboardDeptFilter, setDashboardDeptFilter] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [reportPage, setReportPage] = useState(1);
  const [requestPage, setRequestPage] = useState(1);
  const [pageSize] = useState(10);
  const [editableLeave, setEditableLeave] = useState(null);
  const [editRequestForm, setEditRequestForm] = useState({ type: 'annual', startDate: '', endDate: '', reason: '' });
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const statusTimeoutRef = useRef(null);

  const departmentOptions = useMemo(
    () => [
      'Kesim',
      'Su jeti',
      'Yıkama',
      'Intermac',
      'Lovati',
      'RS',
      'Matkap',
      'Lazer',
      'Spinner',
      'Parmak Rodaj',
      'Besana',
      'Latuada',
      'Multi',
      'LZ',
      'Motorla Silim'
    ],
    []
  );

  const leaveTypeLabels = useMemo(
    () => ({
      annual: 'Yıllık İzin',
      sick: 'Hastalık İzni',
      report: 'Raporlu İzin',
      absence: 'Devamsızlık',
      late: 'Geç Gelme'
    }),
    []
  );

  const backendHost = import.meta.env.VITE_API_BASE?.replace('/api', '') || 'http://localhost:4000';

  function showStatus(message) {
    setStatusMessage(message);
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    statusTimeoutRef.current = setTimeout(() => setStatusMessage(''), 5000);
  }

  function calculateLeaveDays(leave) {
    if (!leave.startDate || !leave.endDate) return 0;
    const start = new Date(leave.startDate);
    const end = new Date(leave.endDate);
    const diff = Math.round((end - start) / (1000 * 60 * 60 * 24));
    return diff >= 0 ? diff + 1 : 0;
  }

  function getTotalLeaveDays(userId) {
    return leaves
      .filter((leave) => leave.userId === userId && leave.status === 'approved')
      .reduce((sum, leave) => sum + calculateLeaveDays(leave), 0);
  }

  function getFilteredReports() {
    const filtered = leaves.filter((leave) => {
      if (reportFilters.type && leave.type !== reportFilters.type) {
        return false;
      }
      if (reportFilters.status && leave.status !== reportFilters.status) {
        return false;
      }
      if (reportFilters.reporterName) {
        const applicant = users.find((u) => u.id === leave.userId);
        if (!applicant || !applicant.name.toLowerCase().includes(reportFilters.reporterName.toLowerCase())) {
          return false;
        }
      }
      const from = reportFilters.fromDate ? new Date(reportFilters.fromDate) : null;
      const to = reportFilters.toDate ? new Date(reportFilters.toDate) : null;
      const leaveStart = new Date(leave.startDate);
      const leaveEnd = new Date(leave.endDate);
      if (from && leaveEnd < from) {
        return false;
      }
      if (to && leaveStart > to) {
        return false;
      }
      return true;
    });

    if (!reportSort) {
      return filtered;
    }

    const referenceDate = reportFilters.fromDate ? new Date(reportFilters.fromDate) : new Date();
    return [...filtered].sort((a, b) => {
      if (reportSort === 'days-asc') {
        return calculateLeaveDays(a) - calculateLeaveDays(b);
      }
      if (reportSort === 'days-desc') {
        return calculateLeaveDays(b) - calculateLeaveDays(a);
      }
      const distanceA = Math.abs(new Date(a.startDate) - referenceDate);
      const distanceB = Math.abs(new Date(b.startDate) - referenceDate);
      if (reportSort === 'date-near') {
        return distanceA - distanceB;
      }
      if (reportSort === 'date-far') {
        return distanceB - distanceA;
      }
      return 0;
    });
  }

  function getReportFilterSummary() {
    const parts = [];
    if (reportFilters.fromDate) {
      parts.push(`Başlangıç ≥ ${reportFilters.fromDate}`);
    }
    if (reportFilters.toDate) {
      parts.push(`Bitiş ≤ ${reportFilters.toDate}`);
    }
    if (reportFilters.type) {
      parts.push(`Tür: ${leaveTypeLabels[reportFilters.type] || reportFilters.type}`);
    }
    if (reportFilters.reporterName) {
      parts.push(`İsim: ${reportFilters.reporterName}`);
    }
    if (reportFilters.status) {
      const statusLabel = reportFilters.status === 'waiting-supervisor'
        ? 'Vardiya Amirinde Bekliyor'
        : reportFilters.status === 'waiting-manager'
          ? 'Müdür Onayında'
          : reportFilters.status === 'approved'
            ? 'Onaylandı'
            : reportFilters.status === 'rejected'
              ? 'Reddedildi'
              : reportFilters.status;
      parts.push(`Durum: ${statusLabel}`);
    }
    if (reportSort) {
      const sortLabel = reportSort === 'days-asc'
        ? 'Güne Göre (Azdan Çoka)'
        : reportSort === 'days-desc'
          ? 'Güne Göre (Çoktan Aza)'
          : reportSort === 'date-near'
            ? 'Tarihe Göre (Yakına Göre)'
            : 'Tarihe Göre (Uzağa Göre)';
      parts.push(`Sıralama: ${sortLabel}`);
    }
    return parts.length > 0 ? parts.join(' · ') : 'Tüm kayıtlar gösteriliyor.';
  }

  function getPaginatedReportItems() {
    const all = getFilteredReports();
    const start = (reportPage - 1) * pageSize;
    return all.slice(start, start + pageSize);
  }

  function getReportTotalPages() {
    return Math.max(1, Math.ceil(getFilteredReports().length / pageSize));
  }

  function getFilteredRequests() {
    const filtered = leaves.filter((leave) => {
      if (reportFilters.type && leave.type !== reportFilters.type) {
        return false;
      }
      if (reportFilters.status && leave.status !== reportFilters.status) {
        return false;
      }
      if (reportFilters.reporterName) {
        const applicant = users.find((u) => u.id === leave.userId);
        if (!applicant || !applicant.name.toLowerCase().includes(reportFilters.reporterName.toLowerCase())) {
          return false;
        }
      }
      const from = reportFilters.fromDate ? new Date(reportFilters.fromDate) : null;
      const to = reportFilters.toDate ? new Date(reportFilters.toDate) : null;
      const leaveStart = new Date(leave.startDate);
      const leaveEnd = new Date(leave.endDate);
      if (from && leaveEnd < from) {
        return false;
      }
      if (to && leaveStart > to) {
        return false;
      }
      return true;
    });
    if (currentUser?.role === 'operator') {
      return filtered.filter((l) => l.userId === currentUser.id);
    }
    if (currentUser?.role === 'supervisor') {
      return filtered.filter((l) => {
        const requester = users.find((u) => u.id === l.userId);
        return requester?.role !== 'manager';
      });
    }
    return filtered;
  }

  function getPaginatedRequestItems() {
    const all = getFilteredRequests();
    const start = (requestPage - 1) * pageSize;
    return all.slice(start, start + pageSize);
  }

  function getRequestTotalPages() {
    return Math.max(1, Math.ceil(getFilteredRequests().length / pageSize));
  }

  function getVisiblePages(total, current, maxButtons = 7) {
    // returns array of numbers and '...' markers
    if (total <= maxButtons) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = [];
    const siblings = 1; // pages around current
    const left = Math.max(2, current - siblings);
    const right = Math.min(total - 1, current + siblings);

    pages.push(1);
    if (left > 2) {
      pages.push('left-ellipsis');
    }
    for (let p = left; p <= right; p++) pages.push(p);
    if (right < total - 1) {
      pages.push('right-ellipsis');
    }
    pages.push(total);
    return pages;
  }

  function getEmployeeSearchResults() {
    return users.filter((user) => user.name.toLowerCase().includes(employeeSearch.toLowerCase()));
  }

  function getTodayDate() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function getWeekdayName(date) {
    return date.toLocaleDateString('tr-TR', { weekday: 'long' });
  }

  function getDateOnly(dateString) {
    const date = new Date(dateString);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function getTodayLeaves() {
    const today = getTodayDate();
    return leaves.filter((leave) => {
      const start = getDateOnly(leave.startDate);
      const end = getDateOnly(leave.endDate);
      if (start.getTime() > today.getTime() || end.getTime() < today.getTime()) {
        return false;
      }
      if (dashboardDeptFilter) {
        const applicant = users.find((u) => u.id === leave.userId);
        return applicant?.department === dashboardDeptFilter;
      }
      return true;
    });
  }

  function getUpcomingLeaves() {
    const today = getTodayDate();
    return leaves.filter((leave) => {
      const start = getDateOnly(leave.startDate);
      if (start.getTime() <= today.getTime()) {
        return false;
      }
      if (leave.status !== 'approved') {
        return false;
      }
      const hasManagerApproval = leave.approvals?.some((entry) => entry.approverRole === 'manager' && entry.action === 'approved');
      if (!hasManagerApproval) {
        return false;
      }
      if (dashboardDeptFilter) {
        const applicant = users.find((u) => u.id === leave.userId);
        return applicant?.department === dashboardDeptFilter;
      }
      return true;
    });
  }

  function getDashboardDepartments() {
    const departments = Array.from(new Set(users.map((u) => u.department).filter(Boolean)));
    departments.sort();
    return departments;
  }

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function load() {
      const token = localStorage.getItem('authToken');
      if (!token) {
        return;
      }
      setAuthToken(token);
      const me = await fetchMe();
      if (me?.id) {
        setCurrentUser(me);
        setIsAuthenticated(true);
        setActiveTab(me.role === 'operator' ? 'leave' : 'dashboard');
        await refreshData();
      } else {
        setAuthToken(null);
      }
    }
    load();
  }, []);

  async function refreshData() {
    try {
      const [userList, dashboardData, leaveData] = await Promise.all([fetchUsers(), fetchDashboard(), fetchLeaves()]);
      setUsers(userList);
      setDashboard(dashboardData);
      setLeaves(leaveData);
    } catch (error) {
      console.error(error);
    }
  }

  function handleCommentChange(leaveId, value) {
    setApprovalComments((prev) => ({ ...prev, [leaveId]: value }));
  }

  function handleStartEditLeave(leave) {
    setEditableLeave(leave);
    setEditRequestForm({
      type: leave.type,
      startDate: leave.startDate,
      endDate: leave.endDate,
      reason: leave.reason || ''
    });
    setActiveTab('requests');
  }

  function handleEditRequestChange(field, value) {
    setEditRequestForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleUpdateLeave(event) {
    event.preventDefault();
    if (!editableLeave) {
      return;
    }
    const response = await updateLeave(editableLeave.id, editRequestForm);
    if (response.error) {
      showStatus(response.error);
    } else {
      showStatus('İzin talebi güncellendi.');
      setEditableLeave(null);
      setEditRequestForm({ type: 'annual', startDate: '', endDate: '', reason: '' });
      await refreshData();
    }
  }

  async function handleCancelLeave(leaveId) {
    if (!window.confirm('Bu talebi iptal etmek istediğinize emin misiniz?')) {
      return;
    }
    const response = await cancelLeave(leaveId);
    showStatus(response.error ? response.error : 'Talep iptal edildi.');
    setEditableLeave((prev) => (prev?.id === leaveId ? null : prev));
    await refreshData();
  }

  async function handleApprove(leaveId) {
    const comment = approvalComments[leaveId] || '';
    const response = await approveLeave(leaveId, { comment });
    showStatus(response.error ? response.error : 'Talep onaylandı.');
    await refreshData();
  }

  async function handleReject(leaveId) {
    const comment = approvalComments[leaveId] || '';
    const response = await rejectLeave(leaveId, { comment });
    showStatus(response.error ? response.error : 'Talep reddedildi.');
    await refreshData();
  }

  const leaveOptions = useMemo(
    () => [
      { value: 'annual', label: 'Yıllık İzin' },
      { value: 'sick', label: 'Hastalık İzni' },
      { value: 'report', label: 'Raporlu İzin' },
      { value: 'absence', label: 'Devamsızlık' },
      { value: 'late', label: 'Geç Gelme' }
    ],
    []
  );

  async function handleLeaveSubmit(event) {
    event.preventDefault();
    const payload = {
      ...formState,
      reportId: uploadedReport?.id,
      reportName: uploadedReport?.originalName || uploadedReport?.name || null,
      reportPath: uploadedReport?.path || null
    };
    const response = await createLeaveRequest(payload);
    if (!response.error) {
      setFormState({ type: 'annual', startDate: '', endDate: '', reason: '' });
      setReportFile(null);
      setUploadedReport(null);
    }
    showStatus(response.error ? response.error : 'İzin talebi gönderildi.');
    await refreshData();
  }

  async function handleCreateUser(event) {
    event.preventDefault();
    const payload = { ...newUserForm };
    const response = await createUser(payload);
    if (response.error) {
      showStatus(response.error);
    } else {
      showStatus('Yeni işçi kaydı tamamlandı.');
      setNewUserForm({
        name: '',
        email: '',
        password: '',
        role: 'operator',
        department: 'Kesim',
        graduation: '',
        startDate: '',
        phone: '',
        notes: ''
      });
      await refreshData();
    }
  }

  async function handleSelectEmployee(user) {
    setSelectedEmployee(user);
    setEditEmployeeForm({
      name: user.name || '',
      email: user.email || '',
      role: user.role || 'operator',
      department: user.department || 'Kesim',
      graduation: user.graduation || '',
      startDate: user.startDate || '',
      phone: user.phone || '',
      notes: user.notes || ''
    });
    setActiveTab('employees');
  }

  async function handleUpdateEmployee(event) {
    event.preventDefault();
    if (!selectedEmployee || !editEmployeeForm) {
      return;
    }
    const response = await updateUser(selectedEmployee.id, editEmployeeForm);
    if (response.error) {
      showStatus(response.error);
    } else {
      showStatus('Çalışan bilgileri güncellendi.');
      setSelectedEmployee(null);
      setEditEmployeeForm(null);
      await refreshData();
    }
  }

  async function handleDeleteEmployee(userId) {
    if (!window.confirm('Bu çalışanı silmek istediğinize emin misiniz?')) {
      return;
    }
    const response = await deleteUser(userId);
    if (response.error) {
      showStatus(response.error);
    } else {
      showStatus('Çalışan silindi.');
      await refreshData();
      if (selectedEmployee?.id === userId) {
        setSelectedEmployee(null);
        setEditEmployeeForm(null);
      }
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    try {
      const response = await login(authForm.email, authForm.password);
      if (response.error) {
        showStatus(response.error);
      } else {
        setAuthToken(response.token);
        setCurrentUser(response.user);
        setIsAuthenticated(true);
        setActiveTab(response.user.role === 'operator' ? 'leave' : 'dashboard');
        await refreshData();
        showStatus('Giriş başarılı.');
      }
    } catch (error) {
      showStatus('Giriş sırasında hata oluştu: ' + error.message);
    }
  }

  function handleLogout() {
    setAuthToken(null);
    setCurrentUser(null);
    setIsAuthenticated(false);
    setUsers([]);
    setDashboard(null);
    setLeaves([]);
    setStatusMessage('');
  }

  async function handlePhotoUpload(event) {
    event.preventDefault();
    if (!photoFile) {
      showStatus('Lütfen bir fotoğraf seçin.');
      return;
    }
    const response = await uploadProfilePhoto(currentUser.id, photoFile);
    if (response.photoUrl) {
      setCurrentUser({ ...currentUser, photoUrl: response.photoUrl });
      showStatus('Fotoğraf yüklendi.');
    } else {
      showStatus(response.error || 'Yükleme sırasında hata oluştu.');
    }
  }

  async function handleLeaveReportUpload(event) {
    event.preventDefault();
    if (!reportFile || !currentUser) {
      showStatus('Lütfen bir rapor dosyası seçin.');
      return;
    }
    const response = await uploadHealthReport(currentUser.id, reportFile);
    if (response.id) {
      setUploadedReport(response);
      showStatus('Sağlık raporu yüklendi. Şimdi izin talebinizi gönderin.');
    } else {
      showStatus(response.error || 'Yükleme sırasında hata oluştu.');
    }
  }

  async function handleReportUpload(event) {
    event.preventDefault();
    if (!reportFile || !currentUser) {
      showStatus('Lütfen bir rapor dosyası seçin.');
      return;
    }
    const response = await uploadHealthReport(currentUser.id, reportFile);
    if (response.id) {
      showStatus('Sağlık raporu yüklendi.');
    } else {
      showStatus(response.error || 'Yükleme sırasında hata oluştu.');
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="app-shell">
        <header>
          <div className="brand">
            <img src={logo} alt="Logo" className="brand-logo" />
            <div>
              <h1>İzin Takip Sistemi</h1>
              <p>Lütfen giriş yapın.</p>
            </div>
          </div>
        </header>
        <main>
          <section className="card form-card">
            <h2>Giriş</h2>
            <form onSubmit={handleLogin}>
              <label>
                E-posta
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
                  required
                />
              </label>
              <label>
                Parola
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
                  required
                />
              </label>
              <button type="submit">Giriş Yap</button>
            </form>
            {statusMessage && <p className="status-message">{statusMessage}</p>}
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header>
        <div className="brand">
          <img src={logo} alt="Logo" className="brand-logo" />
          <div>
            <h1>İzin Takip Sistemi</h1>
            <p>Operatör izin ve rapor takip sistemi</p>
          </div>
        </div>
        <nav>
          {(currentUser.role !== 'operator') && (
            <button onClick={() => setActiveTab('dashboard')} className={activeTab === 'dashboard' ? 'active' : ''}>Dashboard</button>
          )}
          <button onClick={() => setActiveTab('leave')} className={activeTab === 'leave' ? 'active' : ''}>İzin Talebi</button>
          <button onClick={() => setActiveTab('profile')} className={activeTab === 'profile' ? 'active' : ''}>Profil</button>
          <button onClick={() => setActiveTab('requests')} className={activeTab === 'requests' ? 'active' : ''}>Talepler</button>
          {(currentUser.role === 'supervisor' || currentUser.role === 'manager') && (
            <button onClick={() => setActiveTab('newUser')} className={activeTab === 'newUser' ? 'active' : ''}>Yeni İşçi</button>
          )}
          {currentUser.role === 'manager' && (
            <>
              <button onClick={() => setActiveTab('employees')} className={activeTab === 'employees' ? 'active' : ''}>Çalışanlar</button>
              <button onClick={() => setActiveTab('reports')} className={activeTab === 'reports' ? 'active' : ''}>Raporlama</button>
            </>
          )}
        </nav>
        <div className="user-panel">
          <div>
            <strong>{currentUser?.name}</strong> - {currentUser?.role}
          </div>
          <button type="button" onClick={handleLogout}>Çıkış Yap</button>
        </div>
      </header>
      {statusMessage && <div className="notification-toast">{statusMessage}</div>}

      <main>
        {activeTab === 'dashboard' && currentUser.role !== 'operator' && (
          <section>
            <h2>Dashboard</h2>
            <div className="dashboard-top-row">
              <div className="dashboard-clock card">
                <p>{currentTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</p>
                <small>{getWeekdayName(currentTime)} - {currentTime.toLocaleDateString('tr-TR')}</small>
              </div>
              <div className="dashboard-filter card">
                <h3>Bölüm Filtrele</h3>
                <select
                  value={dashboardDeptFilter}
                  onChange={(event) => setDashboardDeptFilter(event.target.value)}
                >
                  <option value="">Tümü</option>
                  {getDashboardDepartments().map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>
            </div>
            {dashboard ? (
              <div className="stats-grid">
                <div className="stat-card">
                  <h3>Bekleyen Talepler</h3>
                  <p>{dashboard.pending}</p>
                </div>
                <div className="stat-card">
                  <h3>Onaylanan</h3>
                  <p>{dashboard.approved}</p>
                </div>
                <div className="stat-card">
                  <h3>Reddedilen</h3>
                  <p>{dashboard.rejected}</p>
                </div>
                <div className="stat-card">
                  <h3>Toplam Kullanıcı</h3>
                  <p>{dashboard.totalUsers}</p>
                </div>
              </div>
            ) : (
              <p>Yükleniyor...</p>
            )}
            <div className="table-card">
              <h3>Bugün İzinli Personeller</h3>
              <table>
                <thead>
                  <tr>
                    <th>Çalışan</th>
                    <th>Bölüm</th>
                    <th>İzin Türü</th>
                    <th>Tarih</th>
                  </tr>
                </thead>
                <tbody>
                  {getTodayLeaves().length === 0 ? (
                    <tr>
                      <td colSpan="4">Bugün izinli personel yok.</td>
                    </tr>
                  ) : (
                    getTodayLeaves().map((leave) => {
                      const applicant = users.find((item) => item.id === leave.userId);
                      return (
                        <tr key={leave.id}>
                          <td>{applicant?.name || leave.userId}</td>
                          <td>{applicant?.department || '-'}</td>
                          <td>{leaveTypeLabels[leave.type] || leave.type}</td>
                          <td>{leave.startDate} - {leave.endDate}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="table-card">
              <h3>Gelecek İzinler</h3>
              <table>
                <thead>
                  <tr>
                    <th>Çalışan</th>
                    <th>Bölüm</th>
                    <th>İzin Türü</th>
                    <th>Başlangıç</th>
                    <th>Bitiş</th>
                  </tr>
                </thead>
                <tbody>
                  {getUpcomingLeaves().length === 0 ? (
                    <tr>
                      <td colSpan="5">Gelecek izin yok.</td>
                    </tr>
                  ) : (
                    getUpcomingLeaves().map((leave) => {
                      const applicant = users.find((item) => item.id === leave.userId);
                      return (
                        <tr key={leave.id}>
                          <td>{applicant?.name || leave.userId}</td>
                          <td>{applicant?.department || '-'}</td>
                          <td>{leaveTypeLabels[leave.type] || leave.type}</td>
                          <td>{leave.startDate}</td>
                          <td>{leave.endDate}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'leave' && (
          <section>
            <h2>İzin Talebi Oluştur</h2>
            <form onSubmit={handleLeaveSubmit} className="card form-card">
              <label>
                İzin Türü
                <select
                  value={formState.type}
                  onChange={(event) => setFormState({ ...formState, type: event.target.value })}
                >
                  {leaveOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Başlangıç Tarihi
                <input
                  type="date"
                  value={formState.startDate}
                  onChange={(event) => setFormState({ ...formState, startDate: event.target.value })}
                  required
                />
              </label>
              <label>
                Bitiş Tarihi
                <input
                  type="date"
                  value={formState.endDate}
                  onChange={(event) => setFormState({ ...formState, endDate: event.target.value })}
                  required
                />
              </label>
              <label>
                İzin Nedeni
                <textarea
                  value={formState.reason}
                  onChange={(event) => setFormState({ ...formState, reason: event.target.value })}
                  rows="4"
                />
              </label>
              <div className="form-card">
                <h3>Sağlık Raporu Ekle</h3>
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(event) => setReportFile(event.target.files?.[0] ?? null)}
                />
                <button type="button" onClick={handleLeaveReportUpload}>Raporu Yükle</button>
                {uploadedReport && (
                  <p className="file-summary">Yüklendi: {uploadedReport.originalName || uploadedReport.name}</p>
                )}
              </div>
              <button type="submit">Talebi Gönder</button>
            </form>
          </section>
        )}

        {activeTab === 'profile' && (
          <section>
            <h2>Profil</h2>
            <div className="profile-grid">
              <div className="profile-card">
                <img
                  src={currentUser.photoUrl || 'https://via.placeholder.com/180?text=Profil'}
                  alt="Profil"
                />
                <h3>{currentUser.name}</h3>
                <p>{currentUser.department}</p>
                <p>{currentUser.email}</p>
              </div>
              <div className="profile-card">
                <form onSubmit={handlePhotoUpload} className="form-card">
                  <h3>Profil Fotoğrafı Yükle</h3>
                  <input type="file" accept="image/png,image/jpeg" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} />
                  <button type="submit">Yükle</button>
                </form>
                <form onSubmit={handleReportUpload} className="form-card">
                  <h3>Sağlık Raporu Yükle</h3>
                  <input
                    type="file"
                    accept="application/pdf,image/png,image/jpeg"
                    onChange={(event) => setReportFile(event.target.files?.[0] ?? null)}
                  />
                  <button type="submit">Raporu Yükle</button>
                </form>
              </div>
            </div>
            <div className="table-card">
              <h3>İzin Geçmişi</h3>
              <table>
                <thead>
                  <tr>
                    <th>Tür</th>
                    <th>Tarih</th>
                    <th>Durum</th>
                    <th>Gün</th>
                  </tr>
                </thead>
                <tbody>
                  {leaves.filter((leave) => leave.userId === currentUser.id).length === 0 ? (
                    <tr>
                      <td colSpan="4">Henüz izin geçmişi yok.</td>
                    </tr>
                  ) : (
                    leaves.filter((leave) => leave.userId === currentUser.id).map((leave) => {
                      const statusLabel = leave.status === 'waiting-supervisor'
                        ? 'Vardiya Amirinde Bekliyor'
                        : leave.status === 'waiting-manager'
                          ? 'Müdür Onayında'
                          : leave.status === 'approved'
                            ? 'Onaylandı'
                            : leave.status === 'rejected'
                              ? 'Reddedildi'
                              : leave.status;
                      return (
                        <tr key={leave.id}>
                          <td>{leaveTypeLabels[leave.type] || leave.type}</td>
                          <td>{leave.startDate} - {leave.endDate}</td>
                          <td>{statusLabel}</td>
                          <td>{calculateLeaveDays(leave)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              <div className="pagination pages">
                {getVisiblePages(getRequestTotalPages(), requestPage).map((p, idx) => (
                  typeof p === 'string' ? (
                    <span key={`e-${idx}`} className="ellipsis">…</span>
                  ) : (
                    <button
                      key={p}
                      className={p === requestPage ? 'page-button active' : 'page-button'}
                      onClick={() => setRequestPage(p)}
                    >
                      {p}
                    </button>
                  )
                ))}
              </div>
            </div>
          </section>
        )}

        {activeTab === 'newUser' && (currentUser.role === 'supervisor' || currentUser.role === 'manager') && (
          <section>
            <h2>Yeni İşçi Kaydı</h2>
            <form onSubmit={handleCreateUser} className="card form-card">
              <label>
                Ad Soyad
                <input
                  type="text"
                  value={newUserForm.name}
                  onChange={(event) => setNewUserForm({ ...newUserForm, name: event.target.value })}
                  required
                />
              </label>
              <label>
                E-posta
                <input
                  type="email"
                  value={newUserForm.email}
                  onChange={(event) => setNewUserForm({ ...newUserForm, email: event.target.value })}
                  required
                />
              </label>
              <label>
                Parola
                <input
                  type="password"
                  value={newUserForm.password}
                  onChange={(event) => setNewUserForm({ ...newUserForm, password: event.target.value })}
                  required
                />
              </label>
              <label>
                Rol
                <select
                  value={newUserForm.role}
                  onChange={(event) => setNewUserForm({ ...newUserForm, role: event.target.value })}
                >
                  <option value="operator">Operatör</option>
                  <option value="supervisor">Vardiya Amiri</option>
                  <option value="manager">Müdür</option>
                </select>
              </label>
              <label>
                Departman
                <select
                  value={newUserForm.department}
                  onChange={(event) => setNewUserForm({ ...newUserForm, department: event.target.value })}
                >
                  {departmentOptions.map((department) => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Mezuniyet
                <select
                  value={newUserForm.graduation}
                  onChange={(event) => setNewUserForm({ ...newUserForm, graduation: event.target.value })}
                >
                  <option value="">Seçiniz</option>
                  <option value="İlkokul">İlkokul</option>
                  <option value="Ortaokul">Ortaokul</option>
                  <option value="Lise">Lise</option>
                  <option value="Üniversite">Üniversite</option>
                  <option value="Yüksek Lisans">Yüksek Lisans</option>
                </select>
              </label>
              <label>
                İşe Başlama Tarihi
                <input
                  type="date"
                  value={newUserForm.startDate}
                  onChange={(event) => setNewUserForm({ ...newUserForm, startDate: event.target.value })}
                />
              </label>
              <label>
                Telefon
                <div className="phone-input">
                  <span>+90</span>
                  <input
                    type="tel"
                    value={newUserForm.phone}
                    maxLength={10}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, '').slice(0, 10);
                      setNewUserForm({ ...newUserForm, phone: digits });
                    }}
                    placeholder="5XXXXXXXXX"
                  />
                </div>
              </label>
              <label>
                Not / Açıklama
                <textarea
                  value={newUserForm.notes}
                  onChange={(event) => setNewUserForm({ ...newUserForm, notes: event.target.value })}
                  rows="4"
                />
              </label>
              <button type="submit">Kaydet</button>
            </form>
          </section>
        )}

        {activeTab === 'employees' && currentUser.role === 'manager' && (
          <section>
            <h2>Çalışanlar</h2>
            <div className="search-filter">
              <label>
                Çalışan Ara
                <input
                  value={employeeSearch}
                  onChange={(event) => setEmployeeSearch(event.target.value)}
                  placeholder="Ad Soyad girin"
                />
              </label>
            </div>
            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>Ad Soyad</th>
                    <th>E-posta</th>
                    <th>Rol</th>
                    <th>Departman</th>
                    <th>Mezuniyet</th>
                    <th>İşe Başlama</th>
                    <th>Telefon</th>
                    <th>Toplam İzin (gün)</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {getEmployeeSearchResults().length === 0 ? (
                    <tr>
                      <td colSpan="9">Çalışan bulunamadı</td>
                    </tr>
                  ) : (
                    getEmployeeSearchResults().map((user) => (
                      <tr key={user.id}>
                        <td>{user.name}</td>
                        <td>{user.email}</td>
                        <td>{user.role}</td>
                        <td>{user.department || '-'}</td>
                        <td>{user.graduation || '-'}</td>
                        <td>{user.startDate || '-'}</td>
                        <td>{user.phone || '-'}</td>
                        <td>{getTotalLeaveDays(user.id)}</td>
                        <td>
                          <button type="button" onClick={() => handleSelectEmployee(user)}>Düzenle</button>
                          <button type="button" className="reject" onClick={() => handleDeleteEmployee(user.id)}>Sil</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {selectedEmployee && editEmployeeForm && (
              <section className="card form-card edit-section">
                <h3>Çalışan Düzenle: {selectedEmployee.name}</h3>
                <form onSubmit={handleUpdateEmployee}>
                  <label>
                    Ad Soyad
                    <input
                      type="text"
                      value={editEmployeeForm.name}
                      onChange={(event) => setEditEmployeeForm({ ...editEmployeeForm, name: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    E-posta
                    <input
                      type="email"
                      value={editEmployeeForm.email}
                      onChange={(event) => setEditEmployeeForm({ ...editEmployeeForm, email: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    Rol
                    <select
                      value={editEmployeeForm.role}
                      onChange={(event) => setEditEmployeeForm({ ...editEmployeeForm, role: event.target.value })}
                    >
                      <option value="operator">Operatör</option>
                      <option value="supervisor">Vardiya Amiri</option>
                      <option value="manager">Müdür</option>
                    </select>
                  </label>
                  <label>
                    Departman
                    <select
                      value={editEmployeeForm.department}
                      onChange={(event) => setEditEmployeeForm({ ...editEmployeeForm, department: event.target.value })}
                    >
                      {departmentOptions.map((department) => (
                        <option key={department} value={department}>
                          {department}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Mezuniyet
                    <input
                      type="text"
                      value={editEmployeeForm.graduation}
                      onChange={(event) => setEditEmployeeForm({ ...editEmployeeForm, graduation: event.target.value })}
                    />
                  </label>
                  <label>
                    İşe Başlama Tarihi
                    <input
                      type="date"
                      value={editEmployeeForm.startDate}
                      onChange={(event) => setEditEmployeeForm({ ...editEmployeeForm, startDate: event.target.value })}
                    />
                  </label>
                  <label>
                    Telefon
                    <input
                      type="tel"
                      value={editEmployeeForm.phone}
                      onChange={(event) => setEditEmployeeForm({ ...editEmployeeForm, phone: event.target.value })}
                    />
                  </label>
                  <label>
                    Not / Açıklama
                    <textarea
                      value={editEmployeeForm.notes}
                      onChange={(event) => setEditEmployeeForm({ ...editEmployeeForm, notes: event.target.value })}
                      rows="3"
                    />
                  </label>
                  <div className="button-group">
                    <button type="submit">Güncelle</button>
                    <button type="button" className="reject" onClick={() => { setSelectedEmployee(null); setEditEmployeeForm(null); }}>Vazgeç</button>
                  </div>
                </form>
              </section>
            )}
          </section>
        )}

        {activeTab === 'reports' && currentUser.role === 'manager' && (
          <section>
            <h2>Yönetici Raporlama</h2>
            <div className="filter-grid">
              <label>
                Başlangıç Tarihi
                <input
                  type="date"
                  value={reportFilters.fromDate}
                  onChange={(event) => setReportFilters({ ...reportFilters, fromDate: event.target.value })}
                />
              </label>
              <label>
                Bitiş Tarihi
                <input
                  type="date"
                  value={reportFilters.toDate}
                  onChange={(event) => setReportFilters({ ...reportFilters, toDate: event.target.value })}
                />
              </label>
              <label>
                Tür
                <select
                  value={reportFilters.type}
                  onChange={(event) => setReportFilters({ ...reportFilters, type: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {leaveOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                İsim
                <input
                  type="text"
                  placeholder="Çalışan ismi"
                  value={reportFilters.reporterName}
                  onChange={(event) => setReportFilters({ ...reportFilters, reporterName: event.target.value })}
                />
              </label>
              <label>
                Sıralama
                <select
                  value={reportSort}
                  onChange={(event) => setReportSort(event.target.value)}
                >
                  <option value="">Varsayılan</option>
                  <option value="days-asc">Güne Göre (Azdan Çoka)</option>
                  <option value="days-desc">Güne Göre (Çoktan Aza)</option>
                  <option value="date-near">Tarihe Göre (Yakına Göre)</option>
                  <option value="date-far">Tarihe Göre (Uzağa Göre)</option>
                </select>
              </label>
              <label>
                Durum
                <select
                  value={reportFilters.status}
                  onChange={(event) => setReportFilters({ ...reportFilters, status: event.target.value })}
                >
                  <option value="">Tümü</option>
                  <option value="waiting-supervisor">Vardiya Amirinde Bekliyor</option>
                  <option value="waiting-manager">Müdür Onayında</option>
                  <option value="approved">Onaylandı</option>
                  <option value="rejected">Reddedildi</option>
                </select>
              </label>
              <div className="filter-actions">
                <button type="button" onClick={() => { setReportFilters({ fromDate: '', toDate: '', status: '', type: '', reporterName: '' }); setReportSort(''); setReportPage(1); setRequestPage(1); }}>Filtreleri Sıfırla</button>
              </div>
            </div>
            <div className="report-summary">
              <strong>Aktif Filtreler:</strong> {getReportFilterSummary()}
            </div>
            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>Çalışan</th>
                    <th>Tür</th>
                    <th>Tarih</th>
                    <th>İzin Nedeni</th>
                    <th>Durum</th>
                    <th>Gün</th>
                    <th>Rapor</th>
                  </tr>
                </thead>
                <tbody>
                  {getPaginatedReportItems().length === 0 ? (
                    <tr>
                      <td colSpan="7">Filtreye uyan izin kaydı bulunamadı</td>
                    </tr>
                  ) : (
                    getPaginatedReportItems().map((leave) => {
                      const applicant = users.find((item) => item.id === leave.userId);
                      const statusLabel = leave.status === 'waiting-supervisor'
                        ? 'Vardiya Amirinde Bekliyor'
                        : leave.status === 'waiting-manager'
                          ? 'Müdür Onayında'
                          : leave.status === 'approved'
                            ? 'Onaylandı'
                            : leave.status === 'rejected'
                              ? 'Reddedildi'
                              : leave.status;
                      return (
                        <tr key={leave.id}>
                          <td>{applicant?.name || leave.userId}</td>
                          <td>{leaveTypeLabels[leave.type] || leave.type}</td>
                          <td>{leave.startDate} - {leave.endDate}</td>
                          <td>{leave.reason || '-'}</td>
                          <td>{statusLabel}</td>
                          <td>{calculateLeaveDays(leave)}</td>
                          <td>
                            {leave.reportPath ? (
                              <a href={`${backendHost}${leave.reportPath}`} target="_blank" rel="noreferrer">Görüntüle</a>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              <div className="pagination pages">
                {getVisiblePages(getReportTotalPages(), reportPage).map((p, idx) => (
                  typeof p === 'string' ? (
                    <span key={`e-${idx}`} className="ellipsis">…</span>
                  ) : (
                    <button
                      key={p}
                      className={p === reportPage ? 'page-button active' : 'page-button'}
                      onClick={() => setReportPage(p)}
                    >
                      {p}
                    </button>
                  )
                ))}
              </div>
            </div>
          </section>
        )}

        {activeTab === 'requests' && (
          <section>
            <h2>İzin Talepleri</h2>
            <div className="filter-grid">
              <label>
                Başlangıç Tarihi
                <input
                  type="date"
                  value={reportFilters.fromDate}
                  onChange={(event) => setReportFilters({ ...reportFilters, fromDate: event.target.value })}
                />
              </label>
              <label>
                Bitiş Tarihi
                <input
                  type="date"
                  value={reportFilters.toDate}
                  onChange={(event) => setReportFilters({ ...reportFilters, toDate: event.target.value })}
                />
              </label>
              <label>
                Tür
                <select
                  value={reportFilters.type}
                  onChange={(event) => setReportFilters({ ...reportFilters, type: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {leaveOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                İsim
                <input
                  type="text"
                  placeholder="Çalışan ismi"
                  value={reportFilters.reporterName}
                  onChange={(event) => setReportFilters({ ...reportFilters, reporterName: event.target.value })}
                />
              </label>
              <label>
                Durum
                <select
                  value={reportFilters.status}
                  onChange={(event) => setReportFilters({ ...reportFilters, status: event.target.value })}
                >
                  <option value="">Tümü</option>
                  <option value="waiting-supervisor">Vardiya Amirinde Bekliyor</option>
                  <option value="waiting-manager">Müdür Onayında</option>
                  <option value="approved">Onaylandı</option>
                  <option value="rejected">Reddedildi</option>
                </select>
              </label>
              <div className="filter-actions">
                <button type="button" onClick={() => { setReportFilters({ fromDate: '', toDate: '', status: '', type: '', reporterName: '' }); setReportSort(''); setReportPage(1); setRequestPage(1); }}>Filtreleri Sıfırla</button>
              </div>
            </div>
            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>Çalışan</th>
                    <th>Tür</th>
                    <th>Tarih Aralığı</th>
                    <th>İzin Nedeni</th>
                    <th>Durum</th>
                    <th>İşlem</th>
                    <th>Onay Geçmişi</th>
                  </tr>
                </thead>
                <tbody>
                  {getFilteredRequests().length === 0 ? (
                    <tr>
                      <td colSpan="7">Henüz talep yok</td>
                    </tr>
                  ) : (
                    getPaginatedRequestItems().map((leave) => {
                      const applicant = users.find((item) => item.id === leave.userId);
                      const statusLabel = leave.status === 'waiting-supervisor'
                        ? 'Vardiya Amirinde Bekliyor'
                        : leave.status === 'waiting-manager'
                          ? 'Müdür Onayında'
                          : leave.status === 'approved'
                            ? 'Onaylandı'
                            : leave.status === 'rejected'
                              ? 'Reddedildi'
                              : leave.status;
                      const requesterRole = applicant?.role;
                      const canApprove = (currentUser.role === 'supervisor' && leave.status === 'waiting-supervisor' && leave.userId !== currentUser.id && requesterRole !== 'supervisor')
                        || (currentUser.role === 'manager' && leave.status === 'waiting-manager');
                      const canReject = canApprove;
                      const canModify = leave.userId === currentUser.id && ['waiting-supervisor', 'waiting-manager'].includes(leave.status);

                      return (
                        <tr key={leave.id}>
                          <td>{applicant?.name || leave.userId}</td>
                          <td>{leaveTypeLabels[leave.type] || leave.type}</td>
                          <td>{leave.startDate} - {leave.endDate}</td>
                          <td>
                            {leave.reason || '-'}
                            {leave.reportPath && (
                              <div className="report-link">
                                <a href={`${backendHost}${leave.reportPath}`} target="_blank" rel="noreferrer">Sağlık Raporunu Görüntüle</a>
                              </div>
                            )}
                          </td>
                          <td>{statusLabel}</td>
                          <td>
                            {canApprove ? (
                              <div className="approval-actions">
                                <textarea
                                  placeholder="Yorum yaz..."
                                  value={approvalComments[leave.id] || ''}
                                  onChange={(event) => handleCommentChange(leave.id, event.target.value)}
                                  rows="3"
                                />
                                <div className="approval-buttons">
                                  <button type="button" onClick={() => handleApprove(leave.id)}>Onayla</button>
                                  <button type="button" className="reject" onClick={() => handleReject(leave.id)}>Reddet</button>
                                </div>
                              </div>
                            ) : null}
                            {canModify ? (
                              <div className="button-group request-actions">
                                <button type="button" onClick={() => handleStartEditLeave(leave)}>Düzenle</button>
                                <button type="button" className="reject" onClick={() => handleCancelLeave(leave.id)}>İptal Et</button>
                              </div>
                            ) : null}
                            {!canApprove && !canModify && <span>-</span>}
                          </td>
                          <td>
                            {leave.approvals && leave.approvals.length > 0 ? (
                              <div className="approval-history">
                                {leave.approvals.map((entry, index) => {
                                  const label = entry.approverRole === 'supervisor'
                                    ? 'Vardiya Amiri'
                                    : entry.approverRole === 'manager'
                                      ? 'Müdür'
                                      : entry.approverRole;
                                  const action = entry.action === 'approved' ? 'Onaylandı' : 'Reddedildi';
                                  return (
                                    <div key={index} className="approval-history-item">
                                      <strong>{label}</strong> · {action} · {new Date(entry.date).toLocaleDateString('tr-TR')}<br />
                                      {entry.comment || '-'}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <span>Beklemede</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {editableLeave && (
              <section className="card form-card edit-section">
                <h3>Talebi Düzenle: {users.find((item) => item.id === editableLeave.userId)?.name || editableLeave.userId}</h3>
                <form onSubmit={handleUpdateLeave}>
                  <label>
                    Tür
                    <select
                      value={editRequestForm.type}
                      onChange={(event) => handleEditRequestChange('type', event.target.value)}
                    >
                      {leaveOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Başlangıç Tarihi
                    <input
                      type="date"
                      value={editRequestForm.startDate}
                      onChange={(event) => handleEditRequestChange('startDate', event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Bitiş Tarihi
                    <input
                      type="date"
                      value={editRequestForm.endDate}
                      onChange={(event) => handleEditRequestChange('endDate', event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    İzin Nedeni
                    <textarea
                      value={editRequestForm.reason}
                      onChange={(event) => handleEditRequestChange('reason', event.target.value)}
                      rows="3"
                    />
                  </label>
                  <div className="button-group">
                    <button type="submit">Güncelle</button>
                    <button type="button" className="reject" onClick={() => setEditableLeave(null)}>Vazgeç</button>
                  </div>
                </form>
              </section>
            )}
          </section>
        )}
      </main>

      <footer>
        <p>İzin Takip Sistemi - Kürşad Sürek 2026</p>
        {statusMessage && <p className="status-message">{statusMessage}</p>}
      </footer>
    </div>
  );
}

export default App;
