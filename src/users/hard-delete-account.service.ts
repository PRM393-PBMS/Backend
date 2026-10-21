import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { HashingService } from '../auth/services/hashing.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';

@Injectable()
export class HardDeleteAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
  ) {}

  async remove(userId: string, password: string): Promise<PbmsResponseDto> {
    if (!isUUID(userId)) return PbmsResponseDto.fail('Vui lòng đăng nhập', 401);
    if (typeof password !== 'string' || !password) {
      return PbmsResponseDto.fail('Vui lòng nhập mật khẩu xác nhận');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) return PbmsResponseDto.fail('Không tìm thấy tài khoản', 404);
    if (!(await this.hashing.compare(password, user.passwordHash))) {
      return PbmsResponseDto.fail('Mật khẩu không đúng');
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
          SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE
        `;
          const current = await tx.user.findUnique({
            where: { id: userId },
            select: {
              passwordHash: true,
              wallet: { select: { balance: true } },
            },
          });
          if (!current)
            return PbmsResponseDto.fail('Không tìm thấy tài khoản', 404);
          if (current.passwordHash !== user.passwordHash) {
            return PbmsResponseDto.fail(
              'Mật khẩu vừa thay đổi. Vui lòng đăng nhập lại',
              409,
            );
          }
          if (current.wallet && !current.wallet.balance.isZero()) {
            return PbmsResponseDto.fail(
              'Cần xử lý hết số dư hoặc công nợ trong ví trước khi xóa',
              409,
            );
          }

          const sessions: Prisma.ParkingSessionWhereInput = {
            OR: [
              { vehicle: { is: { userId } } },
              { reservation: { is: { userId } } },
            ],
          };
          const payments: Prisma.PaymentWhereInput = {
            OR: [
              { userId },
              { session: { is: sessions } },
              { reservation: { is: { userId } } },
              { subscription: { is: { userId } } },
              { walletTransactions: { some: { wallet: { is: { userId } } } } },
            ],
          };
          const [
            inLot,
            subscriptions,
            reservations,
            pending,
            incidents,
            occupied,
          ] = await Promise.all([
            tx.parkingSession.count({
              where: { AND: [sessions, { status: { not: 'Completed' } }] },
            }),
            tx.monthlySubscription.count({
              where: {
                userId,
                OR: [
                  { status: { notIn: ['Active', 'Expired', 'Cancelled'] } },
                  { status: 'Active', endDate: { gt: new Date() } },
                ],
              },
            }),
            tx.reservation.count({
              where: {
                userId,
                status: {
                  notIn: ['Completed', 'Cancelled', 'NoShow', 'Expired'],
                },
              },
            }),
            tx.payment.count({
              where: {
                AND: [
                  payments,
                  { paymentStatus: { notIn: ['Success', 'Failed'] } },
                ],
              },
            }),
            tx.incidentReport.count({
              where: {
                OR: [
                  { reportedByUserId: userId },
                  { session: { is: sessions } },
                ],
                status: { notIn: ['Resolved', 'Cancelled'] },
              },
            }),
            tx.parkingSlot.count({
              where: { assignedUserId: userId, status: 'Occupied' },
            }),
          ]);
          if (
            inLot ||
            subscriptions ||
            reservations ||
            pending ||
            incidents ||
            occupied
          ) {
            return PbmsResponseDto.fail(
              'Chưa thể xóa: còn phiên gửi xe, vé tháng, đặt chỗ, thanh toán hoặc sự cố chưa hoàn tất',
              409,
            );
          }

          // Xóa dữ liệu con trước, tài khoản sau. Mọi thao tác cùng transaction.
          await tx.entryPass.deleteMany({ where: { userId } });
          await tx.notification.deleteMany({ where: { userId } });
          await tx.refreshToken.deleteMany({ where: { userId } });
          await tx.incidentReport.deleteMany({
            where: { reportedByUserId: userId },
          });
          await tx.walletTransaction.deleteMany({
            where: { wallet: { is: { userId } } },
          });
          await tx.walletAdjustmentLog.deleteMany({
            where: { wallet: { is: { userId } } },
          });
          await tx.wallet.deleteMany({ where: { userId } });
          await tx.payment.deleteMany({ where: { userId } });
          await tx.subscriptionContract.deleteMany({ where: { userId } });
          await tx.subscriptionRenewal.deleteMany({
            where: { subscription: { is: { userId } } },
          });
          await tx.vehicleChangeRequest.deleteMany({
            where: { subscription: { is: { userId } } },
          });
          await tx.monthlySubscription.deleteMany({ where: { userId } });
          await tx.parkingSession.deleteMany({ where: sessions });
          await tx.reservation.deleteMany({ where: { userId } });
          await tx.parkingSlot.updateMany({
            where: { assignedUserId: userId, status: 'Assigned' },
            data: { assignedUserId: null, status: 'Available' },
          });
          await tx.parkingSlot.updateMany({
            where: { assignedUserId: userId },
            data: { assignedUserId: null },
          });
          await tx.vehicle.deleteMany({ where: { userId } });
          await tx.user.delete({ where: { id: userId } });
          return PbmsResponseDto.ok('Đã xóa vĩnh viễn tài khoản');
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 20000,
        },
      );
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (['P2003', 'P2014', 'P2034', 'P2025'].includes(error.code)) {
          return PbmsResponseDto.fail(
            'Dữ liệu liên quan vừa thay đổi hoặc còn ràng buộc. Tải lại trước khi thử xóa',
            409,
          );
        }
      }
      throw error;
    }
  }
}
