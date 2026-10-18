import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { isEmptyGuid } from '../common/pbms-fields';
import { normalizeLicensePlate } from '../common/license-plate';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationType =
  | 'system'
  | 'parking'
  | 'payment'
  | 'wallet'
  | 'reservation'
  | 'subscription'
  | 'incident';

export interface NotificationInput {
  title: string;
  message: string;
  type: NotificationType;
  metadata?: Record<string, unknown>;
}

/** "120.000 đ" */
export function formatVnd(amount: number): string {
  return `${Math.round(amount).toLocaleString('vi-VN')} đ`;
}

/** Giờ:phút theo giờ Việt Nam. */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Số thông báo trả về mỗi lần (mới nhất trước). */
const PAGE_SIZE = 50;

/**
 * Thông báo trong app của khách hàng, lưu trong bảng notifications.
 * Các luồng nghiệp vụ gọi [notify] sau khi thao tác đã thành công; lỗi ghi thông báo
 * chỉ được ghi log, không bao giờ làm hỏng giao dịch chính.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async notify(userId: string | null | undefined, input: NotificationInput): Promise<void> {
    if (!userId || isEmptyGuid(userId)) return;
    try {
      await this.prisma.notification.create({
        data: {
          userId,
          title: input.title.slice(0, 120),
          message: input.message.slice(0, 500),
          type: input.type,
          metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (error: unknown) {
      this.logger.warn(`Không ghi được thông báo cho ${userId}: ${String(error)}`);
    }
  }

  /** Báo cho chủ xe theo biển số (xe vãng lai chưa đăng ký thì bỏ qua). */
  async notifyPlateOwner(plate: string | null | undefined, input: NotificationInput): Promise<void> {
    const licensePlate = normalizeLicensePlate(plate);
    if (!licensePlate) return;
    try {
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { licensePlate },
        select: { userId: true },
      });
      await this.notify(vehicle?.userId, input);
    } catch (error: unknown) {
      this.logger.warn(`Không tìm được chủ xe ${licensePlate}: ${String(error)}`);
    }
  }

  async getMine(userId: string): Promise<PbmsResponseDto> {
    const [items, unreadCount, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: PAGE_SIZE,
      }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
      this.prisma.notification.count({ where: { userId } }),
    ]);
    return PbmsResponseDto.ok('Lấy danh sách thông báo thành công', {
      items: items.map((n) => ({
        id: n.id,
        userId: n.userId,
        title: n.title,
        message: n.message,
        type: n.type,
        isRead: n.isRead,
        createdAt: n.createdAt.toISOString(),
        metadata: n.metadata ?? null,
      })),
      unreadCount,
      total,
    });
  }

  async markRead(userId: string, id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) return PbmsResponseDto.fail('NotificationId không hợp lệ');
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
    return count === 0
      ? PbmsResponseDto.fail('Không tìm thấy thông báo', 404)
      : PbmsResponseDto.ok('Đã đánh dấu thông báo đã đọc');
  }

  async markAllRead(userId: string): Promise<PbmsResponseDto> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return PbmsResponseDto.ok('Đã đánh dấu tất cả thông báo đã đọc', { updated: count });
  }

  async remove(userId: string, id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) return PbmsResponseDto.fail('NotificationId không hợp lệ');
    const { count } = await this.prisma.notification.deleteMany({ where: { id, userId } });
    return count === 0
      ? PbmsResponseDto.fail('Không tìm thấy thông báo', 404)
      : PbmsResponseDto.ok('Đã xoá thông báo');
  }
}
