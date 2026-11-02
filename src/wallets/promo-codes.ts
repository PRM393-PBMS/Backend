import { Prisma, PromoCode, WalletBucket } from '@prisma/client';
import { formatVnd } from '../notifications/notifications.service';
import { toMoney } from '../common/pbms-fields';

const DAY_MS = 864e5;

type Db = Pick<Prisma.TransactionClient, 'promoCode' | 'promoRedemption'>;

export const normalizePromoCode = (raw: string) => raw.trim().toUpperCase();

/** Kiểm tra mã khi khách nạp [amount]: trả mã còn dùng được, hoặc lý do từ chối để báo khách. */
export async function checkPromoCode(
  db: Db,
  userId: string,
  rawCode: string,
  amount: number,
  now = new Date(),
): Promise<{ promo: PromoCode; error?: undefined } | { promo?: undefined; error: string }> {
  const promo = await db.promoCode.findUnique({ where: { code: normalizePromoCode(rawCode) } });
  if (!promo || !promo.isActive || now < promo.startsAt || now > promo.endsAt) {
    return { error: 'Mã khuyến mãi không tồn tại hoặc đã hết hạn' };
  }
  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
    return { error: 'Mã khuyến mãi đã hết lượt' };
  }
  if (amount < Number(promo.minTopUp)) {
    return { error: `Mã ${promo.code} chỉ áp dụng khi nạp từ ${formatVnd(toMoney(promo.minTopUp))}` };
  }
  const used = await db.promoRedemption.findUnique({
    where: { promoCodeId_userId: { promoCodeId: promo.id, userId } },
  });
  if (used) {
    return { error: 'Bạn đã dùng mã khuyến mãi này rồi' };
  }
  return { promo };
}

/**
 * Trong giao dịch cộng tiền nạp: giữ một lượt (không vượt maxUses), ghi khách đã dùng mã (mỗi khách một lần,
 * kể cả hai lần nạp cùng mã về cùng lúc), cộng tiền tặng vào ngăn BONUS. Trả số tiền tặng, null nếu không còn áp dụng.
 * Mã hết hạn sau lúc khách tạo link vẫn được tặng: khách đã nhập mã khi mã còn hiệu lực.
 */
export async function grantPromoBonus(
  tx: Prisma.TransactionClient,
  payment: { id: string; userId: string; promoCodeId: string },
  wallet: { id: string; bonusBalance: Prisma.Decimal; bonusExpiresAt: Date | null },
): Promise<Prisma.Decimal | null> {
  const promo = await tx.promoCode.findUnique({ where: { id: payment.promoCodeId } });
  if (!promo) return null;
  const reserved = await tx.$executeRaw`
    UPDATE promo_codes SET used_count = used_count + 1
    WHERE id = ${promo.id}::uuid AND (max_uses IS NULL OR used_count < max_uses)`;
  if (reserved !== 1) return null;
  // ON CONFLICT DO NOTHING: trùng (mã, khách) không làm hỏng giao dịch cộng tiền nạp.
  const inserted = await tx.promoRedemption.createMany({
    data: [{ promoCodeId: promo.id, userId: payment.userId, paymentId: payment.id, bonusAmount: promo.bonusAmount }],
    skipDuplicates: true,
  });
  if (inserted.count !== 1) {
    await tx.promoCode.update({ where: { id: promo.id }, data: { usedCount: { decrement: 1 } } });
    return null;
  }
  const now = new Date();
  const validUntil = new Date(now.getTime() + promo.bonusValidDays * DAY_MS);
  // Ngăn BONUS có một hạn chung: không rút ngắn hạn đang có; tiền tặng cũ đã quá hạn thì bỏ, không hồi sinh.
  const expired = wallet.bonusExpiresAt !== null && wallet.bonusExpiresAt <= now;
  const keepLater = !expired && wallet.bonusExpiresAt !== null && wallet.bonusExpiresAt > validUntil;
  const updated = await tx.wallet.update({
    where: { id: wallet.id },
    data: {
      bonusBalance: expired ? promo.bonusAmount : { increment: promo.bonusAmount },
      bonusExpiresAt: keepLater ? wallet.bonusExpiresAt : validUntil,
    },
  });
  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      paymentId: payment.id,
      type: 'ADJUSTMENT',
      bucket: WalletBucket.BONUS,
      amount: promo.bonusAmount,
      balanceAfter: updated.bonusBalance,
      referenceType: 'PromoCode',
      referenceId: promo.id,
      description: `Khuyến mãi nạp ví ${promo.code}`,
    },
  });
  return promo.bonusAmount;
}
