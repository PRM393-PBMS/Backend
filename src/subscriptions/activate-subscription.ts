import { Prisma } from '@prisma/client';
import { isMotorbikeType } from '../common/license-plate';

/** Vé không kích hoạt được (ô đã có người nhận, hết ô, vé không còn chờ thanh toán). */
export class SubscriptionActivationError extends Error {}

/**
 * Kích hoạt vé tháng vừa thanh toán (ví hoặc PayOS), chạy trong giao dịch của người gọi.
 * Ô tô nhận ô cư dân đúng loại xe, đúng bãi của vé, và chỉ khi ô vẫn còn trống (cập nhật có điều kiện):
 * hai người trả tiền cùng một ô thì người sau bị từ chối thay vì dùng chung ô.
 */
export async function activateSubscriptionInTx(
  tx: Prisma.TransactionClient,
  subscriptionId: string,
): Promise<void> {
  const subscription = await tx.monthlySubscription.findUnique({
    where: { id: subscriptionId },
    include: { package: true, vehicle: { include: { vehicleType: true } } },
  });
  if (!subscription) {
    throw new SubscriptionActivationError(`Không tìm thấy đăng ký gói tháng ${subscriptionId}.`);
  }
  if (subscription.status !== 'PendingPayment') {
    throw new SubscriptionActivationError('Vé tháng không còn ở trạng thái chờ thanh toán.');
  }
  let slotId = subscription.fixedSlotId;
  if (!isMotorbikeType(subscription.vehicle.vehicleType.typeName)) {
    const fits: Prisma.ParkingSlotWhereInput = {
      vehicleTypeId: subscription.vehicle.vehicleTypeId,
      status: 'Available',
      floor: { isResident: true },
      ...(subscription.parkingId ? { parkingId: subscription.parkingId } : {}),
    };
    const candidates = subscription.fixedSlotId
      ? [subscription.fixedSlotId]
      : (
          await tx.parkingSlot.findMany({ where: fits, select: { id: true }, orderBy: { slotCode: 'asc' } })
        ).map((slot) => slot.id);
    slotId = null;
    for (const id of candidates) {
      const taken = await tx.parkingSlot.updateMany({
        where: { ...fits, id },
        data: { status: 'Assigned', assignedUserId: subscription.userId },
      });
      if (taken.count === 1) {
        slotId = id;
        break;
      }
    }
    if (!slotId) {
      throw new SubscriptionActivationError(
        subscription.fixedSlotId
          ? 'Vị trí đỗ cố định đã chọn vừa được người khác nhận.'
          : 'Bãi đã hết vị trí cư dân trống phù hợp với loại xe.',
      );
    }
  }
  const start = new Date();
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + subscription.package.durationDays);
  const moved = await tx.monthlySubscription.updateMany({
    where: { id: subscriptionId, status: 'PendingPayment' },
    data: { status: 'Active', startDate: start, endDate: end, fixedSlotId: slotId },
  });
  if (moved.count !== 1) {
    throw new SubscriptionActivationError('Vé tháng vừa được kích hoạt hoặc huỷ ở nơi khác.');
  }
}

/**
 * Nối thêm [durationDays] ngày cho vé đang hiệu lực hoặc đã hết hạn, ghi lịch sử gia hạn.
 * Cập nhật có điều kiện "ngày hết hạn chưa đổi": hai lần gia hạn cùng lúc (bấm đúp, hai link PayOS)
 * mỗi lần đều được cộng một kỳ thay vì cùng tính từ một ngày hết hạn cũ.
 */
export async function extendSubscriptionInTx(
  tx: Prisma.TransactionClient,
  subscriptionId: string,
  durationDays: number,
  amount: Prisma.Decimal,
): Promise<Date> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const subscription = await tx.monthlySubscription.findUnique({
      where: { id: subscriptionId },
      select: { endDate: true, status: true },
    });
    if (!subscription || !['Active', 'Expired'].includes(subscription.status)) {
      throw new SubscriptionActivationError('Chỉ gia hạn được vé tháng đang hiệu lực hoặc đã hết hạn.');
    }
    // Còn hạn thì nối tiếp từ ngày hết hạn, đã hết hạn thì tính từ hôm nay.
    const oldEnd = subscription.endDate;
    const now = new Date();
    const newEnd = new Date(oldEnd < now ? now : oldEnd);
    newEnd.setUTCDate(newEnd.getUTCDate() + durationDays);
    const moved = await tx.monthlySubscription.updateMany({
      where: { id: subscriptionId, endDate: oldEnd, status: subscription.status },
      data: { endDate: newEnd, status: 'Active' },
    });
    if (moved.count !== 1) continue;
    await tx.subscriptionRenewal.create({
      data: { subscriptionId, oldEndDate: oldEnd, newEndDate: newEnd, amount, renewalDate: now },
    });
    return newEnd;
  }
  throw new SubscriptionActivationError('Vé tháng đang được gia hạn ở nơi khác, vui lòng thử lại.');
}
