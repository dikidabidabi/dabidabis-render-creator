import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { getNotifications, markFeedSeen } from "@/lib/messages.functions";

export type GalleryTarget = { renderId: string; commentId: string; ownerId: string | null };
export type FeedTarget = { kind: "post" | "render"; id: string };

type NotifCtx = {
  unreadMessages: number;
  feedUpdates: number;
  galleryComments: number;
  galleryTarget: GalleryTarget | null;
  feedTarget: FeedTarget | null;
  refresh: () => Promise<void>;
  clearFeed: () => Promise<void>;
};

const NotificationContext = createContext<NotifCtx>({
  unreadMessages: 0,
  feedUpdates: 0,
  galleryComments: 0,
  galleryTarget: null,
  feedTarget: null,
  refresh: async () => {},
  clearFeed: async () => {},
});

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user, session, loading } = useAuth();
  const fetchNotif = useServerFn(getNotifications);
  const seenFn = useServerFn(markFeedSeen);
  const fetchNotifRef = useRef(fetchNotif);
  fetchNotifRef.current = fetchNotif;
  const seenFnRef = useRef(seenFn);
  seenFnRef.current = seenFn;
  const userId = user?.id;
  const accessToken = session?.access_token;
  const expiresAt = session?.expires_at;
  const sessionRef = useRef({ userId, accessToken });
  sessionRef.current = { userId, accessToken };
  const inFlightRef = useRef<string | null>(null);
  const [unreadMessages, setUnread] = useState(0);
  const [feedUpdates, setFeed] = useState(0);
  const [galleryComments, setGallery] = useState(0);
  const [galleryTarget, setGalleryTarget] = useState<GalleryTarget | null>(null);
  const [feedTarget, setFeedTarget] = useState<FeedTarget | null>(null);

  const refresh = useCallback(async () => {
    if (loading || !userId || !accessToken || (expiresAt && expiresAt * 1000 <= Date.now())) {
      setUnread(0);
      setFeed(0);
      setGallery(0);
      setGalleryTarget(null);
      setFeedTarget(null);
      return;
    }
    if (inFlightRef.current === accessToken) return;
    inFlightRef.current = accessToken;
    try {
      const res = await fetchNotifRef.current({});
      if (sessionRef.current.userId !== userId || sessionRef.current.accessToken !== accessToken) return;
      if (!res || typeof res.unreadMessages !== "number") return;
      setUnread(res.unreadMessages);
      setFeed(res.feedUpdates);
      setGallery(res.galleryComments ?? 0);
      setGalleryTarget((res.galleryTarget as GalleryTarget | null) ?? null);
      setFeedTarget((res.feedTarget as FeedTarget | null) ?? null);
    } catch {
      /* diam saja: notifikasi tidak kritis */
    } finally {
      if (inFlightRef.current === accessToken) inFlightRef.current = null;
    }
  }, [userId, accessToken, expiresAt, loading]);


  const clearFeed = useCallback(async () => {
    if (loading || !userId || !accessToken || (expiresAt && expiresAt * 1000 <= Date.now())) return;
    setFeed(0);
    setFeedTarget(null);

    try {
      await seenFnRef.current({});
    } catch {
      /* ignore */
    }
  }, [userId, accessToken, expiresAt, loading]);

  useEffect(() => {
    void refresh();
    if (loading || !userId || !accessToken) return;
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [userId, accessToken, loading, refresh]);

  return (
    <NotificationContext.Provider
      value={{
        unreadMessages,
        feedUpdates,
        galleryComments,
        galleryTarget,
        feedTarget,
        refresh,
        clearFeed,
      }}
    >

      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
