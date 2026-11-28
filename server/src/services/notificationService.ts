import Notification, { NotificationType } from "../models/Notification";
import NotificationPreferences from "../models/NotificationPreferences";
import { logger } from "./structuredLogger";

export interface CreateNotificationOptions {
  recipientWallet: string;
  type: NotificationType;
  message: string;
  deepLink?: string;
  promptId?: string;
  promptTitle?: string;
  idempotencyKey?: string;
  versionIndex?: number;
  changeNote?: string;
}

export class NotificationService {
  static async createNotification(options: CreateNotificationOptions) {
    const recipientWallet = options.recipientWallet.trim().toLowerCase();
    const key = options.idempotencyKey?.trim();
    if (!recipientWallet || (options.idempotencyKey !== undefined && !key)) {
      throw new Error("Recipient and non-empty idempotency key required");
    }
    const filter = { recipientWallet, type: options.type, idempotencyKey: key };
    try {
      return await Notification.create({
        ...options,
        recipientWallet,
        ...(key ? { idempotencyKey: key } : {}),
        read: false,
      });
    } catch (error) {
      if (key && (error as { code?: number }).code === 11000) {
        const existing = await Notification.findOne(filter);
        if (existing) return existing;
      }
      throw error;
    }
  }

  static async markAsRead(notificationId: string) {
    return await Notification.findByIdAndUpdate(
      notificationId,
      { read: true },
      { new: true },
    );
  }

  static async markAsUnread(notificationId: string) {
    return await Notification.findByIdAndUpdate(
      notificationId,
      { read: false },
      { new: true },
    );
  }

  static async markAllAsRead(recipientWallet: string) {
    return await Notification.updateMany(
      { recipientWallet, read: false },
      { read: true },
    );
  }

  static async getUnreadCount(recipientWallet: string) {
    return await Notification.countDocuments({
      recipientWallet,
      read: false,
    });
  }

  static async getNotifications(
    recipientWallet: string,
    options: {
      limit?: number;
      skip?: number;
      type?: NotificationType;
      unreadOnly?: boolean;
    } = {},
  ) {
    const { limit = 20, skip = 0, type, unreadOnly = false } = options;

    const query: any = { recipientWallet };

    if (type) {
      query.type = type;
    }

    if (unreadOnly) {
      query.read = false;
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .exec();

    const total = await Notification.countDocuments(query);

    return {
      notifications,
      total,
      hasMore: skip + limit < total,
    };
  }

  static async deleteNotification(notificationId: string) {
    return await Notification.findByIdAndDelete(notificationId);
  }

  static async deleteOldNotifications(daysOld: number = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await Notification.deleteMany({
      createdAt: { $lt: cutoffDate },
    });

    return result.deletedCount;
  }

  static async sendBulkNotifications(
    notifications: CreateNotificationOptions[],
  ) {
    const results = [];

    for (const notifOptions of notifications) {
      try {
        const notif = await this.createNotification(notifOptions);
        results.push({ success: true, notification: notif });
      } catch (error) {
        results.push({ success: false, error, options: notifOptions });
      }
    }

    return results;
  }

  static async getNotificationsByType(
    recipientWallet: string,
    type: NotificationType,
    limit: number = 10,
  ) {
    return await Notification.find({
      recipientWallet,
      type,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  static async getNotificationsWithDeepLinks(recipientWallet: string) {
    return await Notification.find({
      recipientWallet,
      deepLink: { $exists: true, $ne: null },
    })
      .sort({ createdAt: -1 })
      .exec();
  }
}

/**
 * Legacy notification type names still emitted by older indexer projections.
 * They are normalised to the current persisted enum before writing.
 */
export type LegacyNotificationType =
  | "purchase_confirmed"
  | "dispute_opened"
  | "dispute_resolved"
  | "payout_available"
  | "moderation_action"
  | "ownership_transfer"
  | "system";

export type NotificationDeliveryType = NotificationType | LegacyNotificationType;

export interface NotificationFunctionParams {
  recipientWallet: string;
  type: NotificationDeliveryType;
  message: string;
  deepLink?: string | null;
  promptId?: string | null;
  promptTitle?: string;
  versionIndex?: number | null;
  changeNote?: string;
  /** Stable idempotency key — typically the on-chain event id. */
  idempotencyKey?: string | null;
}

const LEGACY_NOTIFICATION_TYPES: Record<LegacyNotificationType, NotificationType> = {
  purchase_confirmed: "purchase_receipt",
  dispute_opened: "account_lifecycle",
  dispute_resolved: "account_lifecycle",
  payout_available: "entitlement_update",
  moderation_action: "security_alert",
  ownership_transfer: "account_lifecycle",
  system: "account_lifecycle",
};

function normalizeNotificationType(type: NotificationDeliveryType): NotificationType {
  return type in LEGACY_NOTIFICATION_TYPES
    ? LEGACY_NOTIFICATION_TYPES[type as LegacyNotificationType]
    : (type as NotificationType);
}

const NOTIFICATION_RETENTION_DAYS = 90;

/**
 * Idempotent, preference-aware notification write used by the indexer and
 * controllers. Returns `null` when the recipient muted the type or the
 * idempotency key was already delivered.
 */
export async function createNotification(
  params: NotificationFunctionParams,
): Promise<InstanceType<typeof Notification> | null> {
  const wallet = params.recipientWallet.trim().toLowerCase();
  const type = normalizeNotificationType(params.type);
  if (!wallet) throw new Error("Recipient wallet is required");

  try {
    const prefs = await NotificationPreferences.findOne({ walletAddress: wallet }).lean<{
      mutedTypes?: string[];
    } | null>();
    if (prefs?.mutedTypes?.includes(type)) {
      logger.debug("Notification suppressed by user preference", {
        action: "createNotification",
        type,
        wallet,
      });
      return null;
    }
  } catch (prefErr) {
    // Preference lookup failure must never block delivery.
    logger.warn("Failed to load notification preferences; proceeding", {
      action: "createNotification",
      wallet,
      error: prefErr,
    });
  }

  const idempotencyKey = params.idempotencyKey?.trim() || undefined;
  const doc: Record<string, unknown> = {
    recipientWallet: wallet,
    type,
    message: params.message,
    deepLink: params.deepLink ?? null,
    promptId: params.promptId ?? null,
    promptTitle: params.promptTitle ?? "",
    versionIndex: params.versionIndex ?? null,
    changeNote: params.changeNote ?? "",
    read: false,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };

  try {
    return await Notification.create(doc);
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 11000) {
      logger.debug("Notification already exists for idempotency key", {
        action: "createNotification",
        idempotencyKey,
        wallet,
      });
      return null;
    }
    throw err;
  }
}

/** Deliver one notification per recipient with a wallet-scoped dedupe key. */
export async function fanOutNotification(
  recipientWallets: (string | undefined | null)[],
  params: Omit<NotificationFunctionParams, "recipientWallet">,
): Promise<void> {
  const wallets = recipientWallets.filter((w): w is string => Boolean(w));
  await Promise.allSettled(
    wallets.map((wallet) =>
      createNotification({
        ...params,
        recipientWallet: wallet,
        idempotencyKey: params.idempotencyKey
          ? `${params.idempotencyKey}:${wallet.toLowerCase()}`
          : undefined,
      }).catch((err: unknown) => {
        logger.error("fanOutNotification failed for one recipient", {
          action: "fanOutNotification",
          wallet,
          error: err,
        });
      }),
    ),
  );
}

/** Batched fallback for the TTL index; deletes only read, expired rows. */
export async function pruneOldNotifications(
  retentionDays: number = NOTIFICATION_RETENTION_DAYS,
  batchSize: number = 500,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  let totalDeleted = 0;

  for (;;) {
    const docs = await Notification.find(
      { read: true, createdAt: { $lt: cutoff } },
      { _id: 1 },
    )
      .limit(batchSize)
      .lean<{ _id: unknown }[]>();

    if (docs.length === 0) break;
    const result = await Notification.deleteMany({
      _id: { $in: docs.map((d: { _id: unknown }) => d._id) },
    });
    totalDeleted += result.deletedCount;
    if (docs.length < batchSize) break;
  }

  return totalDeleted;
}
