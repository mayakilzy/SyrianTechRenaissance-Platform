import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function notify(userId: string, type: string, title: string, body: string): Promise<void> {
  if (!userId) return;
  await db.notification.create({ data: { userId, type, title, body } });
  logger.info("notification.created", { userId, type });
}

export async function getNotifications(userId: string, unreadOnly = false) {
  return db.notification.findMany({
    where: unreadOnly ? { userId, readAt: null } : { userId },
    orderBy: { createdAt: "desc" }, take: 50,
  });
}

export async function markAsRead(notificationId: string, userId: string): Promise<void> {
  await db.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
}
