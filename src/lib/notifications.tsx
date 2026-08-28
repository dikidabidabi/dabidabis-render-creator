import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
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
  const { user } = useAuth();
  const fetchNotif = useServerFn(getNotifications);
  const seenFn = useServerFn(markFeedSeen);
  const [unreadMessages, setUnread] = useState(0);
  const [feedUpdates, setFeed] = useState(0);
  const [galleryComments, setGallery] = useState(0);
  const [galleryTarget, setGalleryTarget] = useState<GalleryTarget | null>(null);
  const [feedTarget, setFeedTarget] = useState<FeedTarget | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setUnread(0);
      setFeed(0);
      setGallery(0);
      setGalleryTarget(null);
      setFeedTarget(null);
      return;
    }
    try {
      const res = await fetchNotif({});
      setUnread(res.unreadMessages);
      setFeed(res.feedUpdates);
      setGallery(res.galleryComments ?? 0);
      setGalleryTarget((res.galleryTarget as GalleryTarget | null) ?? null);
      setFeedTarget((res.feedTarget as FeedTarget | null) ?? null);
    } catch {
      /* diam saja: notifikasi tidak kritis */
    }
  }, [user, fetchNotif]);


  const clearFeed = useCallback(async () => {
    if (!user) return;
    setFeed(0);
    try {
      await seenFn({});
    } catch {
      /* ignore */
    }
  }, [user, seenFn]);

  useEffect(() => {
    void refresh();
    if (!user) return;
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [user, refresh]);

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
