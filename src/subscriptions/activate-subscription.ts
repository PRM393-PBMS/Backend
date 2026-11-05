import { Db } from '../common/transactions';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors';
export class SubscriptionActivationError extends AppError {
  constructor(
    statusOrMessage: number | string,
    code?: string,
    message?: string,
  ) {
    super(
      typeof statusOrMessage === 'number' ? statusOrMessage : 409,
      code ?? 'SUBSCRIPTION_APPLICATION_CONFLICT',
      message ?? String(statusOrMessage),
    );
  }
}
import { isMotorbikeType } from '../common/license-plate';
export async function activateSubscription(
  tx: Db,
  subscriptionId: string,
  renewing = false,
): Promise<void> {
  const subscription = await tx.monthlySubscription.findUnique({
    where: { id: subscriptionId },
    include: { package: true, vehicle: { include: { vehicleType: true } } },
  });
  if (!subscription)
    throw new SubscriptionActivationError('Không tìm thấy đăng ký gói tháng.');
  if (
    renewing
      ? !['Active', 'Expired'].includes(subscription.status)
      : subscription.status !== 'PendingPayment'
  )
    throw new SubscriptionActivationError(
      409,
      'SUBSCRIPTION_NOT_PENDING',
      'Vé tháng không còn ở trạng thái có thể kích hoạt.',
    );
  const contract = await tx.subscriptionContract.findUnique({
    where: { subscriptionId },
  });
  if (contract && contract.status !== 'Signed')
    throw new SubscriptionActivationError(
      409,
      'CONTRACT_NOT_SIGNED',
      'Hợp đồng chưa được ký',
    );
  let slotId = subscription.fixedSlotId;
  if (
    !isMotorbikeType(subscription.vehicle.vehicleType.typeName) &&
    !subscription.package.allParkings
  ) {
    const fits: Prisma.ParkingSlotWhereInput = {
      vehicleTypeId: subscription.vehicle.vehicleTypeId,
      status: 'Available',
      floor: { isResident: true },
      ...(subscription.parkingId ? { parkingId: subscription.parkingId } : {}),
    };
    const owned =
      renewing && slotId
        ? await tx.parkingSlot.findUnique({ where: { id: slotId } })
        : null;
    const alreadyOwned =
      owned &&
      owned.assignedUserId === subscription.userId &&
      ['Assigned', 'Occupied'].includes(owned.status) &&
      owned.vehicleTypeId === subscription.vehicle.vehicleTypeId &&
      (!subscription.parkingId || owned.parkingId === subscription.parkingId);
    if (!alreadyOwned) {
      const candidates = slotId
        ? [slotId]
        : (
            await tx.parkingSlot.findMany({
              where: fits,
              select: { id: true },
              orderBy: { slotCode: 'asc' },
            })
          ).map((slot) => slot.id);
      slotId = null;
      for (const id of candidates) {
        const claimed = await tx.parkingSlot.updateMany({
          where: { ...fits, id },
          data: { status: 'Assigned', assignedUserId: subscription.userId },
        });
        if (claimed.count === 1) {
          slotId = id;
          break;
        }
      }
      if (!slotId)
        throw new SubscriptionActivationError(
          409,
          'FIXED_SLOT_UNAVAILABLE',
          'Không còn vị trí cư dân trống phù hợp; thanh toán cần đối soát',
        );
    }
  }
  const start = new Date(),
    end = new Date(start);
  end.setUTCDate(end.getUTCDate() + subscription.package.durationDays);
  const moved = await tx.monthlySubscription.updateMany({
    where: { id: subscriptionId, status: subscription.status },
    data: {
      status: 'Active',
      fixedSlotId: slotId,
      ...(renewing ? {} : { startDate: start, endDate: end }),
    },
  });
  if (moved.count !== 1)
    throw new SubscriptionActivationError(
      'Vé tháng vừa được kích hoạt hoặc hủy ở nơi khác.',
    );
}

export const activateSubscriptionInTx = (tx: Db, id: string) =>
  activateSubscription(tx, id);

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
      throw new SubscriptionActivationError(
        'Chỉ gia hạn được vé tháng đang hiệu lực hoặc đã hết hạn.',
      );
    }
    // Còn hạn thì nối tiếp từ ngày hết hạn, đã hết hạn thì tính từ hôm nay.
    const oldEnd = subscription.endDate;
    const now = new Date();
    const newEnd = new Date(oldEnd < now ? now : oldEnd);
    newEnd.setUTCDate(newEnd.getUTCDate() + durationDays);
    const moved = await tx.monthlySubscription.updateMany({
      where: {
        id: subscriptionId,
        endDate: oldEnd,
        status: subscription.status,
      },
      data: { endDate: newEnd, status: 'Active' },
    });
    if (moved.count !== 1) continue;
    await tx.subscriptionRenewal.create({
      data: {
        subscriptionId,
        oldEndDate: oldEnd,
        newEndDate: newEnd,
        amount,
        renewalDate: now,
      },
    });
    return newEnd;
  }
  throw new SubscriptionActivationError(
    'Vé tháng đang được gia hạn ở nơi khác, vui lòng thử lại.',
  );
}
