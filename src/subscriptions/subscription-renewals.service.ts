import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayosService } from '../integrations/payos-files.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import {
  errorMessage,
  isEmptyGuid,
  pbmsPickDate,
  pbmsPickGuid,
  pbmsPickNumber,
  sameStatus,
  toMoney,
} from '../common/pbms-fields';

@Injectable()
export class SubscriptionRenewalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payos: PayosService,
  ) {}

  async renew(subscriptionId: string, userId: string, dto: object): Promise<PbmsResponseDto> {
    const packageId = pbmsPickGuid(dto, 'packageId', 'PackageId');
    if (isEmptyGuid(packageId)) {
      return PbmsResponseDto.fail('Vui lòng chọn gói gia hạn hợp lệ');
    }
    const subscription = await this.prisma.monthlySubscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!subscription) {
      return PbmsResponseDto.fail('Không tìm thấy gói tháng', 404);
    }
    if (subscription.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền gia hạn gói này', 403);
    }
    if (sameStatus(subscription.status, 'Cancelled')) {
      return PbmsResponseDto.fail('Không thể gia hạn gói đã hủy');
    }
    const pkg = await this.prisma.subscriptionPackage.findUnique({ where: { id: packageId } });
    if (!pkg || !sameStatus(pkg.status, 'Active')) {
      return PbmsResponseDto.fail('Gói cước gia hạn không tồn tại hoặc đã ngừng áp dụng');
    }
    if (subscription.vehicleTypeId !== pkg.vehicleTypeId) {
      return PbmsResponseDto.fail('Gói cước mới không phù hợp với loại xe hiện tại');
    }
    try {
      const payment = await this.prisma.payment.create({
        data: {
          userId,
          subscriptionId: subscription.id,
          amount: pkg.price,
          paymentMethod: 'PayOS',
          paymentStatus: 'Pending',
          paymentType: 'SubscriptionRenewal',
          paymentTime: new Date(),
          transactionReference: '',
        },
      });
      const link = await this.payos.createPaymentLink(payment);
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { transactionReference: link.orderCode },
      });
      return PbmsResponseDto.ok(
        'Tạo thanh toán gia hạn thành công',
        {
          subscriptionId: subscription.id,
          paymentId: payment.id,
          amount: toMoney(payment.amount),
          paymentLinkId: link.paymentLinkId,
          paymentUrl: link.paymentUrl,
          orderCode: link.orderCode,
        },
        201,
      );
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi gia hạn gói: ${errorMessage(error)}`, 500);
    }
  }

  async getBySubscription(subscriptionId: string, userId: string, role: string): Promise<PbmsResponseDto> {
    const subscription = await this.prisma.monthlySubscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!subscription) {
      return PbmsResponseDto.fail('Không tìm thấy gói tháng', 404);
    }
    if (!this.canManage(role) && subscription.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền xem gia hạn gói này', 403);
    }
    const items = await this.prisma.subscriptionRenewal.findMany({
      where: { subscriptionId },
      orderBy: { renewalDate: 'desc' },
    });
    return PbmsResponseDto.ok('Lấy lịch sử gia hạn thành công', items.map((item) => this.map(item)));
  }

  async getAll(): Promise<PbmsResponseDto> {
    const items = await this.prisma.subscriptionRenewal.findMany({ orderBy: { renewalDate: 'desc' } });
    return PbmsResponseDto.ok('Lấy danh sách gia hạn thành công', items.map((item) => this.map(item)));
  }

  async getById(id: string, userId: string, role: string): Promise<PbmsResponseDto> {
    const item = await this.prisma.subscriptionRenewal.findUnique({
      where: { id },
      include: { subscription: true },
    });
    if (!item) {
      return PbmsResponseDto.fail('Không tìm thấy gia hạn', 404);
    }
    if (!this.canManage(role) && item.subscription.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền xem gia hạn này', 403);
    }
    return PbmsResponseDto.ok('Lấy gia hạn thành công', this.map(item));
  }

  async directRenew(dto: object): Promise<PbmsResponseDto> {
    const subscriptionId = pbmsPickGuid(dto, 'subscriptionId', 'SubscriptionId');
    const months = pbmsPickNumber(dto, 'months', 'Months') ?? 0;
    const amount = pbmsPickNumber(dto, 'amount', 'Amount') ?? 0;
    if (isEmptyGuid(subscriptionId) || months <= 0) {
      return PbmsResponseDto.fail('Dữ liệu gia hạn trực tiếp không hợp lệ');
    }
    const subscription = await this.prisma.monthlySubscription.findUnique({ where: { id: subscriptionId } });
    if (!subscription) {
      return PbmsResponseDto.fail('Không tìm thấy gói tháng', 404);
    }
    const oldEnd = subscription.endDate;
    const start = oldEnd < new Date() ? new Date() : oldEnd;
    const newEnd = new Date(start);
    newEnd.setUTCMonth(newEnd.getUTCMonth() + months);
    const renewal = await this.prisma.$transaction(async (tx) => {
      await tx.monthlySubscription.update({
        where: { id: subscriptionId },
        data: { endDate: newEnd, status: 'Active' },
      });
      return tx.subscriptionRenewal.create({
        data: {
          subscriptionId,
          oldEndDate: oldEnd,
          newEndDate: newEnd,
          amount: new Prisma.Decimal(amount),
          renewalDate: new Date(),
        },
      });
    });
    return PbmsResponseDto.ok('Gia hạn trực tiếp thành công', this.map(renewal), 201);
  }

  async update(dto: object): Promise<PbmsResponseDto> {
    const id = pbmsPickGuid(dto, 'renewalId', 'RenewalId');
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Dữ liệu cập nhật không hợp lệ');
    }
    const existing = await this.prisma.subscriptionRenewal.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy gia hạn', 404);
    }
    const amount = pbmsPickNumber(dto, 'amount', 'Amount') ?? Number(existing.amount);
    const item = await this.prisma.subscriptionRenewal.update({
      where: { id },
      data: {
        amount: new Prisma.Decimal(amount),
        renewalDate: pbmsPickDate(dto, 'renewalDate', 'RenewalDate') ?? existing.renewalDate,
      },
    });
    return PbmsResponseDto.ok('Cập nhật gia hạn thành công', this.map(item));
  }

  async remove(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập RenewalId');
    }
    const existing = await this.prisma.subscriptionRenewal.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy gia hạn', 404);
    }
    await this.prisma.subscriptionRenewal.delete({ where: { id } });
    return PbmsResponseDto.ok('Xóa gia hạn thành công');
  }

  private canManage(role: string): boolean {
    return role.trim().toLowerCase() === 'manager';
  }

  private map(item: {
    id: string;
    subscriptionId: string;
    oldEndDate: Date;
    newEndDate: Date;
    amount: Prisma.Decimal;
    renewalDate: Date | null;
  }) {
    return {
      renewalId: item.id,
      subscriptionId: item.subscriptionId,
      oldEndDate: item.oldEndDate,
      newEndDate: item.newEndDate,
      amount: toMoney(item.amount),
      renewalDate: item.renewalDate,
    };
  }
}
