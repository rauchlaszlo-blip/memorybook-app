import { useEffect, useState } from 'react';
import { ownerFormat, ownerText, useOwnerUiLanguage } from './ownerUiI18n';

const API_BASE =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';

type NotificationItem = {
  id: string;
  type: string;
  bookId: string;
  bookTitle: string;
  pageId: string;
  actorName?: string | null;
  pageNumber: number;
  readAt?: string | null;
  createdAt: string;
  targetPath: string;
};

export function NotificationMenu() {
  const language = useOwnerUiLanguage();
  const t = (key: string) => ownerText(language, key);
  const f = (key: string, values: Record<string, string | number>) => ownerFormat(language, key, values);
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadUnreadCount = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/my/notifications/unread-count`, {
          credentials: 'include',
        });
        if (!response.ok) return;
        const data = await response.json();
        if (active) setUnreadCount(Number(data?.unreadCount || 0));
      } catch {
        // A badge refresh failure must not block the owner dashboard.
      }
    };

    loadUnreadCount();
    const timer = window.setInterval(loadUnreadCount, 30_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const loadNotifications = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE}/api/my/notifications?limit=20`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('NOTIFICATION_LIST_FAILED');
      const data = await response.json();
      setNotifications(Array.isArray(data?.notifications) ? data.notifications : []);
      setUnreadCount(Number(data?.unreadCount || 0));
    } catch (err) {
      console.error(err);
      setError(t('Nem sikerült betölteni az értesítéseket.'));
    } finally {
      setLoading(false);
    }
  };

  const toggleMenu = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) void loadNotifications();
  };

  const openNotification = async (notification: NotificationItem) => {
    try {
      const response = await fetch(
        `${API_BASE}/api/my/notifications/${encodeURIComponent(notification.id)}/read`,
        {
          method: 'PATCH',
          credentials: 'include',
        }
      );
      if (response.ok) {
        const data = await response.json();
        setUnreadCount(Number(data?.unreadCount || 0));
      }
    } catch {
      // Navigation is still useful even if the read-state update fails.
    } finally {
      window.location.href = notification.targetPath;
    }
  };

  return (
    <div style={styles.wrapper}>
      <button
        type="button"
        onClick={toggleMenu}
        style={styles.iconButton}
        aria-label={`${t('Értesítések')}${unreadCount > 0 ? `, ${f('{count} olvasatlan', { count: unreadCount })}` : ''}`}
        aria-expanded={open}
      >
        <span aria-hidden="true" style={styles.bell}>🔔</span>
        {unreadCount > 0 && (
          <span style={styles.badge}>{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div style={styles.menu} role="region" aria-label={t('Értesítések')}>
          <div style={styles.menuHeader}>
            <strong>{t('Értesítések')}</strong>
            {unreadCount > 0 && <span style={styles.unreadLabel}>{f('{count} új', { count: unreadCount })}</span>}
          </div>

          {loading && <div style={styles.state}>{t('Betöltés...')}</div>}
          {!loading && error && <div style={styles.error}>{error}</div>}
          {!loading && !error && notifications.length === 0 && (
            <div style={styles.state}>{t('Nincs értesítés.')}</div>
          )}

          {!loading && !error && notifications.length > 0 && (
            <div style={styles.list}>
              {notifications.map((notification) => {
                const message = notification.actorName
                  ? f('{name} visszaküldte a {page}. oldalt.', { name: notification.actorName, page: notification.pageNumber })
                  : f('Visszaérkezett a {page}. oldal.', { page: notification.pageNumber });

                return (
                  <button
                    type="button"
                    key={notification.id}
                    onClick={() => void openNotification(notification)}
                    style={{
                      ...styles.item,
                      ...(notification.readAt ? styles.readItem : styles.unreadItem),
                    }}
                  >
                    <span style={styles.message}>{message}</span>
                    <span style={styles.bookTitle}>{notification.bookTitle}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { position: 'relative' },
  iconButton: {
    position: 'relative',
    width: 44,
    height: 44,
    border: '1px solid #cbd5e1',
    borderRadius: 10,
    background: '#ffffff',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  bell: { fontSize: 20, lineHeight: 1 },
  badge: {
    position: 'absolute',
    top: -7,
    right: -7,
    minWidth: 20,
    height: 20,
    padding: '0 5px',
    borderRadius: 999,
    background: '#dc2626',
    color: '#ffffff',
    border: '2px solid #f1f5f9',
    fontSize: 11,
    fontWeight: 800,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
  },
  menu: {
    position: 'absolute',
    top: 52,
    right: 0,
    width: 'min(360px, calc(100vw - 36px))',
    maxHeight: 'min(520px, calc(100vh - 110px))',
    overflow: 'hidden',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    boxShadow: '0 18px 45px rgba(15, 23, 42, 0.18)',
    zIndex: 50,
  },
  menuHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '14px 16px',
    borderBottom: '1px solid #e2e8f0',
    color: '#0f172a',
  },
  unreadLabel: { fontSize: 12, color: '#475569', fontWeight: 700 },
  list: { maxHeight: 440, overflowY: 'auto' },
  item: {
    width: '100%',
    border: 0,
    borderBottom: '1px solid #e2e8f0',
    padding: '13px 16px',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'block',
  },
  unreadItem: { background: '#eff6ff' },
  readItem: { background: '#ffffff' },
  message: { display: 'block', color: '#0f172a', fontSize: 14, fontWeight: 700, lineHeight: 1.4 },
  bookTitle: { display: 'block', marginTop: 4, color: '#64748b', fontSize: 12, overflowWrap: 'anywhere' },
  state: { padding: 18, color: '#64748b', fontSize: 14 },
  error: { padding: 18, color: '#991b1b', fontSize: 14 },
};
