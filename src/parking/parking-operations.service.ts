import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, type ParkingSession } from '@prisma/client';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { PayosService } from '../integrations/payos-files.service';
import { PlateRecognizerService } from '../integrations/plate-recognizer.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import {
  errorMessage,
  isEmptyGuid,
  pbmsPick,
  pbmsPickGuid,
  sameStatus,
  toMoney,
} from '../common/pbms-fields';
import {
  isMotorbikeType,
  isValidLicensePlate,
  normalizeLicensePlate,
} from '../common/license-plate';
import { freeParkingAvailability } from '../common/free-parking-availability';
import { createTicket, extractGuidFromQrPayload } from '../common/qr.util';
import { ParkingSessionsService } from './parking-sessions.service';
import {
  exitPassPayload,
  generateExitPassCode,
  issueExitPass,
  mapExitPass,
  parseShortGateCode,
} from '../common/exit-pass';
import { effectiveEntryPassStatus, parseEntryPassPayload } from '../common/entry-pass';
import { PaymentsService } from '../payments/payments.service';
import { InsufficientWalletFundsError, WalletsService } from '../wallets/wallets.service';
import { NotificationsService, formatTime, formatVnd } from '../notifications/notifications.service';
import { ENTRY_WINDOW_MS, HELD_STATUSES, inEntryWindow } from '../reservations/reservation-rules';

/** Phiên đã được thanh toán trước bởi một yêu cầu khác. */
class AlreadyPrepaidError extends Error {}

@Injectable()
export class ParkingOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payos: PayosService,
    private readonly plates: PlateRecognizerService,
    private readonly sessions: ParkingSessionsService,
    private readonly payments: PaymentsService,
    private readonly wallets: WalletsService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async checkIn(dto: object): Promise<PbmsResponseDto> {
    // Quét mã QR gửi xe một lần của khách (hoặc gõ tay mã chữ 6 ký tự): không cần chọn loại khách.
    const scanned = pbmsPick(dto, 'qrPayload', 'QrPayload');
    const shortCode = parseShortGateCode(scanned);
    const entryPass = shortCode
      ? await this.entryPassByShortCode(shortCode)
      : parseEntryPassPayload(scanned);
    if (entryPass instanceof PbmsResponseDto) {
      return entryPass;
    }
    if (entryPass) {
      const gate = await this.resolveGate(pbmsPickGuid(dto, 'gateId', 'GateId'), 'Entry');
      if ('error' in gate) {
        return gate.error ?? PbmsResponseDto.fail('Cổng không hợp lệ');
      }
      return this.checkInEntryPass(dto, gate.gate, entryPass);
    }
    const customerType = this.normalizeCustomer(pbmsPick(dto, 'customerType', 'CustomerType'));
    if (!customerType) {
      return PbmsResponseDto.fail('Vui lòng chọn CustomerType: Guest, Resident hoặc Reservation');
    }
    const gateId = pbmsPickGuid(dto, 'gateId', 'GateId');
    const gate = await this.resolveGate(gateId, 'Entry');
    if ('error' in gate) {
      return gate.error ?? PbmsResponseDto.fail('Cổng không hợp lệ');
    }
    if (customerType === 'Reservation') {
      return this.checkInReservation(dto, gate.gate);
    }
    if (customerType === 'Resident') {
      return this.checkInResident(dto, gate.gate);
    }
    return this.checkInGuest(dto, gate.gate);
  }

  async checkOut(dto: object): Promise<PbmsResponseDto> {
    const gateId = pbmsPickGuid(dto, 'gateId', 'GateId');
    const gate = await this.resolveGate(gateId, 'Exit');
    if ('error' in gate) {
      return gate.error ?? PbmsResponseDto.fail('Cổng không hợp lệ');
    }
    const sessionId = await this.resolveSessionId(dto);
    if (sessionId instanceof PbmsResponseDto) {
      return sessionId;
    }
    const session = await this.prisma.parkingSession.findUnique({
      where: { id: sessionId },
      include: { vehicle: { select: { userId: true } }, vehicleType: true },
    });
    if (!session || !sameStatus(session.status, 'Active')) {
      return PbmsResponseDto.fail('Không tìm thấy phiên gửi xe đang hoạt động', 404);
    }
    const scanned = pbmsPick(dto, 'qrPayload', 'QrPayload').trim();
    if (
      scanned.startsWith('PBMS-EXIT:') &&
      (!session.exitPassCode || scanned !== exitPassPayload(session.id, session.exitPassCode))
    ) {
      return PbmsResponseDto.fail('Mã ra cổng không hợp lệ hoặc đã hết hiệu lực', 403);
    }
    const plateOutRead = normalizeLicensePlate(pbmsPick(dto, 'licensePlateOut', 'LicensePlateOut'));
    // Xe ra phải đúng xe đã vào: chặn ở máy chủ, không chỉ dựa vào web.
    if (plateOutRead && plateOutRead !== session.licensePlateIn) {
      return PbmsResponseDto.fail(
        `Biển số xe ra ${plateOutRead} không khớp biển số lúc vào ${session.licensePlateIn}`,
        409,
      );
    }
    const exitTime = new Date();
    const plateOut = plateOutRead || session.licensePlateIn;
    await this.prisma.parkingSession.update({
      where: { id: session.id },
      data: {
        exitGateId: gate.gate.id,
        exitTime,
        licensePlateOut: plateOut,
        exitImageUrl: pbmsPick(dto, 'exitImageUrl', 'ExitImageUrl').trim() || null,
        driverExitImageUrl: pbmsPick(dto, 'driverExitImageUrl', 'DriverExitImageUrl').trim() || null,
      },
    });

    const subscription = await this.activeSubscription(
      session.licensePlateIn,
      session.vehicleTypeId,
      exitTime,
      gate.gate.floor.parkingId,
    );
    if (session.prepaidAt && session.exitPassCode) {
      // Khách đã thanh toán trước trên app: mã ra cổng có hiệu lực tới khi xe ra.
      await this.closeSession(session.id, subscription?.fixedSlotId ?? null);
      return PbmsResponseDto.ok(
        'Checkout thành công (đã thanh toán trước trên ứng dụng)',
        await this.loadSession(session.id),
      );
    }
    if (!session.reservationId && subscription) {
      await this.closeSession(session.id, subscription.fixedSlotId);
      const mapped = await this.loadSession(session.id);
      return PbmsResponseDto.ok('Checkout thành công (đã bao gồm trong gói tháng)', mapped);
    }

    const fee = await this.calculateFee(session, exitTime);
    if (fee instanceof PbmsResponseDto) {
      return fee;
    }
    if (fee.amount <= 0) {
      await this.closeSession(session.id, subscription?.fixedSlotId ?? null);
      return PbmsResponseDto.ok('Checkout thành công', {
        Session: await this.loadSession(session.id),
        Fee: fee,
      });
    }

    const method = this.normalizeMethod(pbmsPick(dto, 'paymentMethod', 'PaymentMethod')) || 'Cash';
    const stale = await this.closePendingCheckoutPayments(session.id);
    if (stale) return stale;
    const payment = await this.prisma.payment.create({
      data: {
        userId: session.vehicle?.userId ?? null,
        sessionId: session.id,
        reservationId: session.reservationId,
        amount: new Prisma.Decimal(fee.amount),
        paymentMethod: method,
        paymentType: 'CheckoutFee',
        paymentTime: exitTime,
        paymentStatus: 'Pending',
        transactionReference: '',
      },
    });

    if (method === 'PayOS') {
      try {
        const link = await this.payos.createPaymentLink(payment);
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { transactionReference: link.orderCode },
        });
        return PbmsResponseDto.ok('Đã tạo yêu cầu thanh toán checkout', {
          Payment: this.mapPayment(payment, link.orderCode),
          OnlinePayment: {
            paymentUrl: link.paymentUrl,
            paymentLinkId: link.paymentLinkId,
            orderCode: link.orderCode,
            // Chuỗi VietQR: màn hình cổng hiển thị, khách quét bằng app ngân hàng.
            qrCode: link.qrCode,
          },
          Fee: fee,
        });
      } catch (error: unknown) {
        return PbmsResponseDto.fail(`Không thể tạo liên kết thanh toán: ${errorMessage(error)}`, 502);
      }
    }

    return PbmsResponseDto.ok('Chờ xác nhận tiền mặt để hoàn tất checkout', {
      Payment: this.mapPayment(payment),
      Fee: fee,
    });
  }

  /**
   * Bấm checkout lại (bấm hai lần, đổi tiền mặt sang PayOS, thử lại khi mạng chập chờn): đóng yêu cầu
   * thanh toán cũ còn chờ trước khi tạo yêu cầu mới, để mỗi phiên chỉ có một khoản đang chờ trả.
   * Link PayOS cũ không huỷ được (có thể khách đang trả) thì dừng, không tạo thêm.
   */
  private async closePendingCheckoutPayments(sessionId: string): Promise<PbmsResponseDto | null> {
    const pending = await this.prisma.payment.findMany({
      where: { sessionId, paymentType: 'CheckoutFee', paymentStatus: 'Pending' },
    });
    for (const p of pending) {
      const orderCode = p.transactionReference?.trim();
      if (sameStatus(p.paymentMethod, 'PayOS') && orderCode) {
        try {
          await this.payos.cancelPaymentLink(orderCode);
        } catch {
          return PbmsResponseDto.fail(
            'Đang có yêu cầu thanh toán PayOS cho xe này. Chờ khách trả xong hoặc huỷ yêu cầu đó trước khi checkout lại.',
            409,
          );
        }
      }
      await this.prisma.payment.updateMany({
        where: { id: p.id, paymentStatus: 'Pending' },
        data: { paymentStatus: 'Failed' },
      });
    }
    return null;
  }

  async getFeePreview(sessionId: string): Promise<PbmsResponseDto> {
    const session = await this.prisma.parkingSession.findUnique({
      where: { id: sessionId },
      include: { vehicle: { select: { userId: true } } },
    });
    if (!session || !sameStatus(session.status, 'Active')) {
      return PbmsResponseDto.fail('Không tìm thấy phiên gửi xe đang hoạt động', 404);
    }
    const pending = await this.prisma.payment.findFirst({
      where: { sessionId, paymentType: 'CheckoutFee', paymentStatus: 'Pending' },
    });
    const calculatedAt = pending?.paymentTime ?? new Date();
    const subscription = await this.activeSubscription(
      session.licensePlateIn,
      session.vehicleTypeId,
      calculatedAt,
      await this.parkingOfGate(session.entryGateId),
    );
    const totalHours = Math.max(0, (calculatedAt.getTime() - session.entryTime.getTime()) / 36e5);
    const billedHours = Math.max(1, Math.ceil(totalHours));
    if (!session.reservationId && subscription) {
      return PbmsResponseDto.ok('Phí gửi xe đã được bao gồm trong gói tháng', {
        sessionId: session.id,
        licensePlate: session.licensePlateIn,
        entryTime: session.entryTime,
        exitTime: calculatedAt,
        totalHours: Math.round(totalHours * 100) / 100,
        billedHours,
        amount: 0,
        isCoveredBySubscription: true,
      });
    }
    const fee = await this.calculateFee(session, calculatedAt);
    if (fee instanceof PbmsResponseDto) {
      return fee;
    }
    return PbmsResponseDto.ok('Tính phí gửi xe tạm tính thành công', fee);
  }

  async getMyFeePreview(sessionId: string, userId: string): Promise<PbmsResponseDto> {
    const owner = await this.assertOwner(sessionId, userId);
    return owner ?? this.getFeePreview(sessionId);
  }

  /**
   * Khách thanh toán trước khi ra bãi (ví hoặc PayOS). Thành công sẽ sinh mã ra cổng,
   * mã có hiệu lực tới khi xe ra khỏi bãi, không phát sinh thêm phí.
   */
  async prepay(sessionId: string, userId: string, dto: object): Promise<PbmsResponseDto> {
    const owner = await this.assertOwner(sessionId, userId);
    if (owner) {
      return owner;
    }
    const session = await this.prisma.parkingSession.findUnique({ where: { id: sessionId } });
    if (!session || !sameStatus(session.status, 'Active')) {
      return PbmsResponseDto.fail('Phiên gửi xe đã kết thúc', 409);
    }
    if (session.exitPassCode) {
      return PbmsResponseDto.ok('Bạn đã thanh toán, dùng mã ra cổng để lấy xe', {
        ExitPass: await mapExitPass(session),
      });
    }
    const atGate = await this.prisma.payment.findFirst({
      where: { sessionId, paymentType: 'CheckoutFee', paymentStatus: 'Pending' },
    });
    if (atGate) {
      return PbmsResponseDto.fail(
        'Xe đang làm thủ tục ở cổng ra, vui lòng thanh toán theo yêu cầu tại cổng',
        409,
      );
    }
    const now = new Date();
    const subscription = await this.activeSubscription(
      session.licensePlateIn,
      session.vehicleTypeId,
      now,
      await this.parkingOfGate(session.entryGateId),
    );
    if (!session.reservationId && subscription) {
      return PbmsResponseDto.fail('Xe đang dùng vé tháng, không cần thanh toán khi ra', 409);
    }
    const fee = await this.calculateFee(session, now);
    if (fee instanceof PbmsResponseDto) {
      return fee;
    }
    if (fee.amount <= 0) {
      await issueExitPass(this.prisma, session.id);
      return PbmsResponseDto.ok('Không phát sinh phí, đã cấp mã ra cổng', {
        Fee: fee,
        ExitPass: await this.exitPassOf(session.id),
      });
    }

    const method = pbmsPick(dto, 'paymentMethod', 'PaymentMethod').trim().toLowerCase();
    if (method === 'wallet') {
      const paid = await this.prisma
        .$transaction(async (tx) => {
          // Giữ phiên trước khi trừ ví: hai yêu cầu cùng lúc (bấm lại khi mạng chậm, hai máy)
          // thì yêu cầu sau không chiếm được và không bị trừ tiền lần nữa.
          const claimed = await tx.parkingSession.updateMany({
            where: { id: session.id, status: 'Active', exitPassCode: null },
            data: { prepaidAt: now, exitPassCode: generateExitPassCode() },
          });
          if (claimed.count !== 1) {
            throw new AlreadyPrepaidError();
          }
          const payment = await tx.payment.create({
            data: {
              userId,
              sessionId: session.id,
              reservationId: session.reservationId,
              amount: new Prisma.Decimal(fee.amount),
              paymentMethod: 'Wallet',
              paymentType: 'PrepaidCheckout',
              paymentTime: now,
              paymentStatus: 'Success',
              transactionReference: '',
            },
          });
          // Dùng ví của module wallets. Thiếu tiền thì ném lỗi và huỷ cả giao dịch,
          // không để lại thanh toán "thành công" ảo.
          await this.wallets.debitForUser(
            tx,
            userId,
            new Prisma.Decimal(fee.amount),
            'ParkingFee',
            payment.id,
            'Thanh toán phí gửi xe bằng ví',
          );
          return payment;
        })
        .catch((error: unknown) => {
          if (error instanceof InsufficientWalletFundsError) {
            return null;
          }
          if (error instanceof AlreadyPrepaidError) {
            return 'already' as const;
          }
          throw error;
        });
      if (paid === 'already') {
        return PbmsResponseDto.ok('Bạn đã thanh toán, dùng mã ra cổng để lấy xe', {
          ExitPass: await this.exitPassOf(session.id),
        });
      }
      if (!paid) {
        const balance = await this.wallets.getBalanceForUser(userId);
        return new PbmsResponseDto('Số dư ví không đủ, vui lòng nạp thêm', 402, false, {
          paymentMethod: 'Wallet',
          walletId: balance.walletId,
          walletBalance: balance.walletBalance,
          amount: fee.amount,
        });
      }
      // Đã trả bằng ví: link PayOS mở trước đó không được thu thêm lần nữa.
      await this.cancelPendingPrepayLinks(session.id);
      await this.notifications?.notify(userId, {
        title: 'Đã thanh toán trước bằng ví',
        message: `Đã trừ ${formatVnd(fee.amount)} từ ví PBMS. Mã ra cổng dùng được tới khi xe rời bãi.`,
        type: 'payment',
        metadata: { sessionId: session.id, paymentId: paid.id },
      });
      return PbmsResponseDto.ok('Đã thanh toán bằng ví và cấp mã ra cổng', {
        Payment: this.mapPayment(paid),
        Fee: fee,
        ExitPass: await this.exitPassOf(session.id),
        WalletBalance: (await this.wallets.getBalanceForUser(userId)).walletBalance,
      });
    }
    if (method !== 'payos') {
      return PbmsResponseDto.fail('Phương thức thanh toán trước chỉ được là Wallet hoặc PayOS');
    }

    // Phí tăng theo giờ: huỷ các link cũ để khách không trả theo số tiền đã lỗi thời.
    await this.cancelPendingPrepayLinks(sessionId);
    const payment = await this.prisma.payment.create({
      data: {
        userId,
        sessionId: session.id,
        reservationId: session.reservationId,
        amount: new Prisma.Decimal(fee.amount),
        paymentMethod: 'PayOS',
        paymentType: 'PrepaidCheckout',
        paymentTime: now,
        paymentStatus: 'Pending',
        transactionReference: '',
      },
    });
    try {
      const link = await this.payos.createPaymentLink(payment);
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { transactionReference: link.orderCode },
      });
      return PbmsResponseDto.ok('Đã tạo liên kết thanh toán trước', {
        Payment: this.mapPayment(payment, link.orderCode),
        OnlinePayment: {
          paymentUrl: link.paymentUrl,
          paymentLinkId: link.paymentLinkId,
          orderCode: link.orderCode,
          qrCode: link.qrCode,
        },
        Fee: fee,
      });
    } catch (error: unknown) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { paymentStatus: 'Failed' } });
      return PbmsResponseDto.fail(`Không thể tạo liên kết thanh toán: ${errorMessage(error)}`, 502);
    }
  }

  private async cancelPendingPrepayLinks(sessionId: string) {
    const stale = await this.prisma.payment.findMany({
      where: { sessionId, paymentType: 'PrepaidCheckout', paymentStatus: 'Pending' },
    });
    for (const old of stale) {
      await this.prisma.payment.updateMany({
        where: { id: old.id, paymentStatus: 'Pending' },
        data: { paymentStatus: 'Failed' },
      });
      if (old.transactionReference) {
        await this.payos.cancelPaymentLink(old.transactionReference).catch(() => undefined);
      }
    }
  }

  /** Trạng thái thanh toán trước: đồng bộ link PayOS đang chờ rồi trả mã ra cổng nếu có. */
  async getMyExitPass(sessionId: string, userId: string): Promise<PbmsResponseDto> {
    const owner = await this.assertOwner(sessionId, userId);
    if (owner) {
      return owner;
    }
    const pending = await this.prisma.payment.findFirst({
      where: {
        sessionId,
        paymentType: 'PrepaidCheckout',
        paymentStatus: 'Pending',
        paymentMethod: 'PayOS',
      },
      orderBy: { paymentTime: 'desc' },
    });
    let paymentStatus: string | null = null;
    if (pending) {
      try {
        paymentStatus = await this.payments.syncPayosPayment(pending.id);
      } catch (error: unknown) {
        return PbmsResponseDto.fail(`Không kiểm tra được thanh toán: ${errorMessage(error)}`, 502);
      }
    }
    return PbmsResponseDto.ok('Lấy mã ra cổng thành công', {
      PaymentStatus: paymentStatus,
      ExitPass: await this.exitPassOf(sessionId),
    });
  }

  private async exitPassOf(sessionId: string) {
    const session = await this.prisma.parkingSession.findUnique({ where: { id: sessionId } });
    return session ? mapExitPass(session) : null;
  }

  async getMyCheckoutPayment(sessionId: string, userId: string): Promise<PbmsResponseDto> {
    const owner = await this.assertOwner(sessionId, userId);
    if (owner) {
      return owner;
    }
    const payment = await this.prisma.payment.findFirst({
      where: { sessionId, paymentType: 'CheckoutFee', paymentStatus: 'Pending' },
      orderBy: { paymentTime: 'desc' },
    });
    if (!payment) {
      return PbmsResponseDto.ok('Chưa có yêu cầu thanh toán checkout', {
        Payment: null,
        OnlinePayment: null,
      });
    }
    let onlinePayment: object | null = null;
    if (sameStatus(payment.paymentMethod, 'PayOS') && payment.transactionReference) {
      try {
        const link = await this.payos.getPaymentLink(payment.transactionReference);
        onlinePayment = {
          paymentUrl: link.paymentUrl,
          paymentLinkId: link.paymentLinkId,
          orderCode: payment.transactionReference,
          qrCode: link.qrCode,
        };
      } catch (error: unknown) {
        return PbmsResponseDto.fail(`Không thể tải liên kết thanh toán: ${errorMessage(error)}`, 502);
      }
    }
    return PbmsResponseDto.ok('Lấy yêu cầu thanh toán checkout thành công', {
      Payment: this.mapPayment(payment),
      OnlinePayment: onlinePayment,
    });
  }

  async getCheckoutPayment(paymentId: string): Promise<PbmsResponseDto> {
    let payment = await this.findCheckoutPayment(paymentId);
    if (payment instanceof PbmsResponseDto) {
      return payment;
    }
    // Màn hình cổng gọi lặp lại API này: tra PayOS để biết khách đã quét mã trả tiền
    // ngay cả khi webhook chưa tới (khách vãng lai không có tài khoản trên app).
    let onlinePayment: object | null = null;
    if (
      sameStatus(payment.paymentMethod, 'PayOS') &&
      sameStatus(payment.paymentStatus, 'Pending') &&
      payment.transactionReference
    ) {
      try {
        await this.payments.syncPayosPayment(payment.id);
        const fresh = await this.findCheckoutPayment(paymentId);
        if (!(fresh instanceof PbmsResponseDto)) {
          payment = fresh;
        }
        if (sameStatus(payment.paymentStatus, 'Pending') && payment.transactionReference) {
          const link = await this.payos.getPaymentLink(payment.transactionReference);
          onlinePayment = {
            paymentUrl: link.paymentUrl,
            paymentLinkId: link.paymentLinkId,
            orderCode: payment.transactionReference,
            qrCode: link.qrCode,
          };
        }
      } catch (error: unknown) {
        return PbmsResponseDto.fail(`Không thể tải liên kết thanh toán: ${errorMessage(error)}`, 502);
      }
    }
    return PbmsResponseDto.ok('Lấy trạng thái thanh toán checkout thành công', {
      Payment: this.mapPayment(payment),
      OnlinePayment: onlinePayment,
      Session: payment.sessionId ? await this.loadSession(payment.sessionId) : null,
    });
  }

  /** [staffId]: nhân viên nhận tiền, giữ tiền đến khi chốt nộp quản lý (sổ quỹ). */
  async confirmCash(paymentId: string, staffId?: string): Promise<PbmsResponseDto> {
    const payment = await this.findCheckoutPayment(paymentId);
    if (payment instanceof PbmsResponseDto) {
      return payment;
    }
    if (!sameStatus(payment.paymentMethod, 'Cash')) {
      return PbmsResponseDto.fail('Chỉ thanh toán tiền mặt mới được nhân viên xác nhận thủ công');
    }
    if (sameStatus(payment.paymentStatus, 'Success')) {
      return PbmsResponseDto.ok('Thanh toán đã được xác nhận trước đó', {
        Payment: this.mapPayment(payment),
        Session: payment.sessionId ? await this.loadSession(payment.sessionId) : null,
      });
    }
    if (!sameStatus(payment.paymentStatus, 'Pending')) {
      return PbmsResponseDto.fail('Thanh toán đã bị hủy hoặc thất bại, không thể xác nhận', 409);
    }
    const session = await this.prisma.parkingSession.findUnique({ where: { id: payment.sessionId! } });
    if (!session?.exitGateId || !session.exitTime) {
      return PbmsResponseDto.fail('Yêu cầu checkout chưa có đủ thông tin cổng ra và thời gian ra', 409);
    }
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        paymentStatus: 'Success',
        paymentTime: new Date(),
        collectedById: staffId ?? null,
        collectedGateId: session.exitGateId,
      },
    });
    await this.closeSession(session.id, null);
    return PbmsResponseDto.ok('Đã nhận tiền mặt và checkout thành công', {
      Payment: this.mapPayment({ ...payment, paymentStatus: 'Success' }),
      Session: await this.loadSession(session.id),
    });
  }

  async cancelCheckout(paymentId: string): Promise<PbmsResponseDto> {
    const payment = await this.findCheckoutPayment(paymentId);
    if (payment instanceof PbmsResponseDto) {
      return payment;
    }
    if (sameStatus(payment.paymentStatus, 'Success')) {
      return PbmsResponseDto.fail('Thanh toán đã thành công nên không thể hủy checkout', 409);
    }
    if (sameStatus(payment.paymentStatus, 'Failed')) {
      return PbmsResponseDto.ok('Yêu cầu checkout đã được hủy trước đó', { Payment: this.mapPayment(payment) });
    }
    if (sameStatus(payment.paymentMethod, 'PayOS') && payment.transactionReference) {
      try {
        await this.payos.cancelPaymentLink(payment.transactionReference);
      } catch (error: unknown) {
        return PbmsResponseDto.fail(`Không thể hủy liên kết thanh toán: ${errorMessage(error)}`, 502);
      }
    }
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { paymentStatus: 'Failed' },
    });
    if (payment.sessionId) {
      await this.prisma.parkingSession.update({
        where: { id: payment.sessionId },
        data: {
          exitGateId: null,
          exitTime: null,
          licensePlateOut: null,
          exitImageUrl: null,
          driverExitImageUrl: null,
        },
      });
    }
    return PbmsResponseDto.ok('Đã hủy yêu cầu checkout', {
      Payment: this.mapPayment({ ...payment, paymentStatus: 'Failed' }),
    });
  }

  async recognizePlate(file: import('../common/uploaded-image').UploadedImage, imageUrl: string | null) {
    const result = await this.plates.recognize(file, imageUrl);
    return result;
  }

  async decodeQr(file: import('../common/uploaded-image').UploadedImage, imageUrl: string | null): Promise<PbmsResponseDto> {
    const payload = await this.decodeQrBuffer(file.buffer);
    if (!payload) {
      return PbmsResponseDto.fail('Không tìm thấy mã QR trong ảnh', 422);
    }
    const resolved = await this.resolveQr(payload);
    if (resolved instanceof PbmsResponseDto) {
      return resolved;
    }
    return PbmsResponseDto.ok('Giải mã QR thành công', {
      qrPayload: payload.trim(),
      codeType: resolved.codeType,
      reservationId: resolved.reservationId,
      sessionId: resolved.sessionId,
      imageUrl,
    });
  }

  async resolveQrPayload(dto: object): Promise<PbmsResponseDto> {
    const payload = pbmsPick(dto, 'qrPayload', 'QrPayload');
    if (!payload.trim()) {
      return PbmsResponseDto.fail('Vui lòng gửi QrPayload');
    }
    const resolved = await this.resolveQr(payload);
    if (resolved instanceof PbmsResponseDto) {
      return resolved;
    }
    return PbmsResponseDto.ok('Giải mã payload QR thành công', {
      qrPayload: payload.trim(),
      ...resolved,
    });
  }

  async availability(
    vehicleTypeId?: string,
    floorKeyword?: string,
  ): Promise<PbmsResponseDto> {
    const slots = await this.prisma.parkingSlot.findMany({
      where: {
        ...(vehicleTypeId ? { vehicleTypeId } : {}),
        ...(floorKeyword
          ? {
              floor: {
                floorName: {
                  contains: floorKeyword.trim(),
                  mode: 'insensitive',
                },
              },
            }
          : {}),
      },
      include: { floor: true, vehicleType: true },
    });
    const grouped = new Map<
      string,
      {
        parkingId: string;
        floorId: string;
        floorName: string;
        /// Tầng cư dân: chỉ cho vé tháng, khách vãng lai không gửi được.
        isResident: boolean;
        vehicleTypeId: string;
        vehicleTypeName: string;
        totalSlots: number;
        availableSlots: number;
        occupiedSlots: number;
        assignedSlots: number;
      }
    >();
    for (const slot of slots) {
      if (isMotorbikeType(slot.vehicleType.typeName)) continue;
      const key = `${slot.floorId}:${slot.vehicleTypeId}`;
      const current = grouped.get(key) ?? {
        parkingId: slot.parkingId,
        floorId: slot.floorId,
        floorName: slot.floor.floorName,
        isResident: slot.floor.isResident,
        vehicleTypeId: slot.vehicleTypeId,
        vehicleTypeName: slot.vehicleType.typeName,
        totalSlots: 0,
        availableSlots: 0,
        occupiedSlots: 0,
        assignedSlots: 0,
      };
      current.totalSlots += 1;
      if (sameStatus(slot.status, 'Available')) current.availableSlots += 1;
      if (sameStatus(slot.status, 'Occupied')) current.occupiedSlots += 1;
      if (sameStatus(slot.status, 'Assigned')) current.assignedSlots += 1;
      grouped.set(key, current);
    }
    const requestedType = vehicleTypeId
      ? await this.prisma.vehicleType.findUnique({
          where: { id: vehicleTypeId },
        })
      : null;
    for (const floor of await freeParkingAvailability(
      this.prisma,
      floorKeyword,
    )) {
      if (vehicleTypeId && !isMotorbikeType(requestedType?.typeName)) continue;
      const row = { ...floor, isResident: false };
      if (requestedType) {
        row.vehicleTypeId = requestedType.id;
        row.vehicleTypeName = requestedType.typeName;
      }
      grouped.set(`${row.floorId}:${row.vehicleTypeId}`, row);
    }
    return PbmsResponseDto.ok(
      'Lấy tình trạng chỗ trống thành công',
      [...grouped.values()].sort((a, b) =>
        a.floorName.localeCompare(b.floorName),
      ),
    );
  }

  private async checkInGuest(
    dto: object,
    gate: { id: string; floorId: string },
  ): Promise<PbmsResponseDto> {
    const plate = normalizeLicensePlate(
      pbmsPick(dto, 'licensePlate', 'LicensePlate'),
    );
    if (!isValidLicensePlate(plate)) {
      return PbmsResponseDto.fail('Biển số phải gồm 4-15 chữ cái và chữ số');
    }
    // Xe đã đặt chỗ (đã cọc) đến đúng khung giờ: đọc biển số là đủ, tự dùng đặt chỗ để trừ cọc.
    const booked = await this.reservationAtGate(plate, gate);
    if (booked) {
      return this.checkInReservation({ ...dto, reservationId: booked.id, licensePlate: plate }, gate);
    }
    // Xe đã đăng ký gửi một lần trên app: camera đọc biển số là đủ, không cần quét mã QR.
    const pass = await this.activeEntryPassOf(plate);
    const chosenTypeId = pbmsPickGuid(dto, 'vehicleTypeId', 'VehicleTypeId');
    if (
      pass &&
      !isEmptyGuid(chosenTypeId) &&
      chosenTypeId !== pass.vehicle.vehicleTypeId
    ) {
      return PbmsResponseDto.fail(
        `Xe ${plate} đã đăng ký gửi một lần là ${pass.vehicle.vehicleType?.typeName ?? 'loại xe khác'}, không đúng loại xe của cổng này`,
        409,
      );
    }
    const vehicleTypeId = isEmptyGuid(chosenTypeId)
      ? pass?.vehicle.vehicleTypeId ?? ''
      : chosenTypeId;
    if (isEmptyGuid(vehicleTypeId)) {
      return PbmsResponseDto.fail('Vui lòng chọn loại phương tiện');
    }
    const sub = await this.activeSubscription(
      plate,
      vehicleTypeId,
      new Date(),
      await this.parkingOfGate(gate),
    );
    if (sub) {
      return PbmsResponseDto.fail(
        'Biển số này đang có gói tháng hợp lệ. Vui lòng check-in Resident',
        403,
      );
    }
    const busy = await this.prisma.parkingSession.findFirst({
      where: { licensePlateIn: plate, status: 'Active' },
    });
    if (busy) {
      return PbmsResponseDto.fail(
        'Xe này đang có phiên gửi xe chưa checkout',
        409,
      );
    }
    const registeredVehicle = pass
      ? pass.vehicle
      : await this.prisma.vehicle.findFirst({
          where: { licensePlate: plate, vehicleTypeId },
        });
    const session = await this.createActiveSession({
      licensePlate: plate,
      vehicleTypeId,
      gate,
      customerType: 'Guest',
      entryPassId: pass?.id,
      dto,
      vehicleId: registeredVehicle?.id ?? null,
    });
    if (session instanceof PbmsResponseDto) return session;
    return PbmsResponseDto.ok(
      pass
        ? 'Check-in thành công (xe đã đăng ký gửi một lần)'
        : 'Check-in xe vãng lai thành công',
      await this.loadSession(session.id),
      201,
    );
  }

  /** Đặt chỗ đã cọc của biển số, đang trong khung vào bãi, đặt cho bãi của cổng này (hoặc đơn cũ không gắn bãi). */
  private async reservationAtGate(plate: string, gate: { floorId: string }) {
    const now = new Date();
    const parkingId = await this.parkingOfGate(gate);
    return this.prisma.reservation.findFirst({
      where: {
        status: { in: [...HELD_STATUSES] },
        vehicle: { is: { licensePlate: plate } },
        expectedEntryTime: {
          gte: new Date(now.getTime() - ENTRY_WINDOW_MS),
          lte: new Date(now.getTime() + ENTRY_WINDOW_MS),
        },
        ...(parkingId ? { OR: [{ parkingId }, { parkingId: null }] } : {}),
      },
      orderBy: { expectedEntryTime: 'asc' },
      select: { id: true },
    });
  }

  /** Mã gửi xe một lần còn hiệu lực của biển số (mỗi xe giữ tối đa một mã). */
  private activeEntryPassOf(plate: string) {
    return this.prisma.entryPass.findFirst({
      where: {
        status: 'Active',
        expiresAt: { gt: new Date() },
        vehicle: { is: { licensePlate: plate } },
      },
      include: { vehicle: { include: { vehicleType: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Check-in bằng mã gửi xe một lần: như xe vãng lai nhưng biển số / loại xe lấy theo mã. */
  private async checkInEntryPass(
    dto: object,
    gate: { id: string; floorId: string },
    scanned: { passId: string; code: string },
  ): Promise<PbmsResponseDto> {
    const pass = await this.prisma.entryPass.findUnique({
      where: { id: scanned.passId },
      include: { vehicle: true },
    });
    if (!pass || pass.code !== scanned.code) {
      return PbmsResponseDto.fail('Mã vào bãi không hợp lệ', 404);
    }
    const status = effectiveEntryPassStatus(pass);
    if (status !== 'Active') {
      const reason =
        status === 'Used'
          ? 'đã được sử dụng'
          : status === 'Cancelled'
            ? 'đã bị huỷ'
            : 'đã hết hạn';
      return PbmsResponseDto.fail(`Mã vào bãi ${reason}`, 409);
    }
    const plate = pass.vehicle.licensePlate;
    // Camera / nhân viên đọc được biển số khác biển trên mã: không cho vào bằng mã này.
    const seen = normalizeLicensePlate(
      pbmsPick(
        dto,
        'licensePlate',
        'LicensePlate',
        'licensePlateIn',
        'LicensePlateIn',
      ),
    );
    if (seen && seen !== plate) {
      return PbmsResponseDto.fail(
        `Biển số xe (${seen}) không khớp mã vào bãi (${plate})`,
        409,
      );
    }
    const vehicleTypeId = pass.vehicle.vehicleTypeId;
    const sub = await this.activeSubscription(
      plate,
      vehicleTypeId,
      new Date(),
      await this.parkingOfGate(gate),
    );
    if (sub) {
      return PbmsResponseDto.fail(
        'Xe đang có vé tháng hợp lệ, vui lòng check-in khách tháng',
        409,
      );
    }
    const busy = await this.prisma.parkingSession.findFirst({
      where: { licensePlateIn: plate, status: 'Active' },
    });
    if (busy) {
      return PbmsResponseDto.fail(
        'Xe này đang có phiên gửi xe chưa checkout',
        409,
      );
    }
    const session = await this.createActiveSession({
      licensePlate: plate,
      vehicleTypeId,
      gate,
      customerType: 'Guest',
      entryPassId: pass.id,
      dto,
      vehicleId: pass.vehicleId,
    });
    if (session instanceof PbmsResponseDto) return session;
    return PbmsResponseDto.ok(
      'Check-in bằng mã vào bãi thành công',
      await this.loadSession(session.id),
      201,
    );
  }

  private async checkInResident(
    dto: object,
    gate: { id: string; floorId: string },
  ): Promise<PbmsResponseDto> {
    const plate = normalizeLicensePlate(
      pbmsPick(dto, 'licensePlate', 'LicensePlate'),
    );
    if (!isValidLicensePlate(plate)) {
      return PbmsResponseDto.fail('Biển số phải gồm 4-15 chữ cái và chữ số');
    }
    const now = new Date();
    const sub = await this.prisma.monthlySubscription.findFirst({
      where: {
        vehicle: { is: { licensePlate: plate } },
        status: 'Active',
        startDate: { lte: now },
        endDate: { gte: now },
        ...this.validAtParking(await this.parkingOfGate(gate)),
      },
      include: { vehicle: { include: { vehicleType: true } }, package: true },
    });
    if (!sub) {
      return PbmsResponseDto.fail(
        'Không tìm thấy gói tháng hiệu lực tại bãi này cho biển số này',
        404,
      );
    }
    const busy = await this.prisma.parkingSession.findFirst({
      where: { licensePlateIn: plate, status: 'Active' },
    });
    if (busy) {
      return PbmsResponseDto.fail(
        'Xe này đang có phiên gửi xe chưa checkout',
        409,
      );
    }
    const session = await this.createActiveSession({
      licensePlate: plate,
      vehicleTypeId: sub.vehicle.vehicleTypeId,
      gate,
      customerType: 'Resident',
      fixedSlotId: sub.fixedSlotId,
      allowAnyResidentSlot: sub.package?.allParkings ?? false,
      userId: sub.userId,
      dto,
      vehicleId: sub.vehicleId,
    });
    if (session instanceof PbmsResponseDto) return session;
    return PbmsResponseDto.ok(
      'Check-in khách tháng thành công',
      await this.loadSession(session.id),
      201,
    );
  }

  private async checkInReservation(
    dto: object,
    gate: { id: string; floorId: string },
  ): Promise<PbmsResponseDto> {
    const reservationId =
      pbmsPickGuid(dto, 'reservationId', 'ReservationId') ||
      extractGuidFromQrPayload(pbmsPick(dto, 'qrPayload', 'QrPayload')) ||
      '';
    const plate = normalizeLicensePlate(
      pbmsPick(dto, 'licensePlate', 'LicensePlate'),
    );
    if (isEmptyGuid(reservationId)) {
      return PbmsResponseDto.fail(
        'Vui lòng quét mã đặt chỗ hoặc gửi QrPayload',
      );
    }
    if (!isValidLicensePlate(plate)) {
      return PbmsResponseDto.fail('Vui lòng nhập biển số');
    }
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { vehicle: true },
    });
    if (!reservation) {
      return PbmsResponseDto.fail('Không tìm thấy đặt chỗ', 404);
    }
    if (!reservation.vehicle) {
      return PbmsResponseDto.fail('Đặt chỗ chưa được liên kết với xe', 409);
    }
    if (reservation.vehicle.licensePlate !== plate) {
      return PbmsResponseDto.fail(
        'Biển số không khớp với xe đã chọn khi đặt chỗ',
        403,
      );
    }
    if (
      !sameStatus(reservation.status, 'Confirmed') &&
      !sameStatus(reservation.status, 'Modified')
    ) {
      return PbmsResponseDto.fail(
        'Đặt chỗ phải ở trạng thái Confirmed hoặc Modified để check-in',
      );
    }
    const now = new Date();
    if (!inEntryWindow(reservation.expectedEntryTime, now)) {
      return PbmsResponseDto.fail(
        'Ngoài khung giờ vào bãi của đặt chỗ (từ 30 phút trước đến 30 phút sau giờ hẹn)',
      );
    }
    const gateParkingId = await this.parkingOfGate(gate);
    if (reservation.parkingId && gateParkingId && reservation.parkingId !== gateParkingId) {
      const booked = await this.prisma.parking.findUnique({
        where: { id: reservation.parkingId },
        select: { name: true },
      });
      return PbmsResponseDto.fail(
        `Đặt chỗ này ở ${booked?.name ?? 'bãi khác'}, không vào được bãi của cổng này`,
        409,
      );
    }
    const sub = await this.activeSubscription(
      plate,
      reservation.vehicle.vehicleTypeId,
      now,
      gateParkingId,
    );
    if (sub) {
      return PbmsResponseDto.fail(
        'Biển số này đang có gói tháng hợp lệ. Không thể check-in bằng vé đặt trước; vui lòng check-in tại tầng cư dân / khách tháng',
        403,
      );
    }
    const busy = await this.prisma.parkingSession.findFirst({
      where: { licensePlateIn: plate, status: 'Active' },
    });
    if (busy) {
      return PbmsResponseDto.fail(
        'Xe này đang có phiên gửi xe chưa checkout',
        409,
      );
    }
    const session = await this.createActiveSession({
      licensePlate: plate,
      vehicleTypeId: reservation.vehicle.vehicleTypeId,
      vehicleId: reservation.vehicleId,
      gate,
      customerType: 'Reservation',
      reservationId: reservation.id,
      dto,
    });
    if (session instanceof PbmsResponseDto) return session;
    return PbmsResponseDto.ok(
      'Check-in xe đặt trước thành công',
      await this.loadSession(session.id),
      201,
    );
  }

  private async createActiveSession(input: {
    licensePlate: string;
    vehicleTypeId: string;
    gate: { id: string; floorId: string };
    customerType: 'Guest' | 'Resident' | 'Reservation';
    fixedSlotId?: string | null;
    allowAnyResidentSlot?: boolean;
    userId?: string;
    entryPassId?: string;
    reservationId?: string;
    dto: object;
    vehicleId?: string | null;
  }) {
    let created: ParkingSession;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // Cùng biển số được tuần tự hóa giữa các cổng, kể cả xe chưa đăng ký tài khoản.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.licensePlate}, 0))::text`;
        const busy = await tx.parkingSession.findFirst({
          where: { licensePlateIn: input.licensePlate, status: 'Active' },
        });
        if (busy)
          throw PbmsResponseDto.fail(
            'Xe này đang có phiên gửi xe chưa checkout',
            409,
          );

        const floor = await tx.floor.findUnique({
          where: { id: input.gate.floorId },
          include: { dedicatedVehicleType: true },
        });
        if (!floor)
          throw PbmsResponseDto.fail('Không tìm thấy tầng của cổng', 404);
        const resident = input.customerType === 'Resident';
        if (floor.isResident !== resident)
          throw PbmsResponseDto.fail(
            'Cổng không thuộc khu dành cho loại khách này',
            409,
          );
        const type = await tx.vehicleType.findUnique({
          where: { id: input.vehicleTypeId },
        });
        if (!type)
          throw PbmsResponseDto.fail('Không tìm thấy loại phương tiện', 404);
        let slotId: string | null = null;
        if (isMotorbikeType(type.typeName)) {
          if (!isMotorbikeType(floor.dedicatedVehicleType?.typeName)) {
            throw PbmsResponseDto.fail(
              'Vui lòng chọn cổng của khu xe máy',
              409,
            );
          }
          await tx.$queryRaw`SELECT id FROM floors WHERE id = ${floor.id}::uuid FOR UPDATE`;
          // Đọc lại sức chứa sau khi khóa để không dùng giá trị cũ khi tầng vừa được cập nhật.
          const capacity = await tx.floor.findUniqueOrThrow({
            where: { id: floor.id },
            select: { totalCapacity: true },
          });
          const occupied = await tx.parkingSession.count({
            where: {
              status: 'Active',
              entryGate: { is: { floorId: floor.id } },
            },
          });
          if (occupied >= capacity.totalCapacity)
            throw PbmsResponseDto.fail('Khu xe máy đã hết sức chứa', 409);
        } else {
          if (isMotorbikeType(floor.dedicatedVehicleType?.typeName)) {
            throw PbmsResponseDto.fail('Vui lòng chọn cổng của khu ô tô', 409);
          }
          const useFixedSlot = resident && !input.allowAnyResidentSlot;
          const slot = useFixedSlot
            ? input.fixedSlotId &&
              (await tx.parkingSlot.findFirst({
                where: {
                  id: input.fixedSlotId,
                  parkingId: floor.parkingId,
                  vehicleTypeId: input.vehicleTypeId,
                  assignedUserId: input.userId,
                  status: 'Assigned',
                  floor: { isResident: true },
                },
              }))
            : await this.findAvailableSlot(
                tx,
                input.vehicleTypeId,
                floor.id,
                floor.parkingId,
                resident,
              );
          if (!slot)
            throw PbmsResponseDto.fail(
              'Không có vị trí đỗ khả dụng tại bãi này',
              409,
            );
          const claimed = await tx.parkingSlot.updateMany({
            where: {
              id: slot.id,
              parkingId: floor.parkingId,
              status: useFixedSlot ? 'Assigned' : 'Available',
            },
            data: { status: 'Occupied' },
          });
          if (claimed.count !== 1)
            throw PbmsResponseDto.fail(
              'Vị trí vừa được xe khác sử dụng, vui lòng thử lại',
              409,
            );
          slotId = slot.id;
        }
        if (input.entryPassId) {
          const pass = await tx.entryPass.updateMany({
            where: {
              id: input.entryPassId,
              status: 'Active',
              expiresAt: { gt: new Date() },
            },
            data: { status: 'Used', usedAt: new Date() },
          });
          if (pass.count !== 1)
            throw PbmsResponseDto.fail(
              'Mã vào bãi đã được sử dụng hoặc hết hạn',
              409,
            );
        }
        if (input.reservationId) {
          const reservation = await tx.reservation.updateMany({
            where: {
              id: input.reservationId,
              status: { in: ['Confirmed', 'Modified'] },
            },
            data: { status: 'CheckedIn' },
          });
          if (reservation.count !== 1)
            throw PbmsResponseDto.fail('Đặt chỗ không còn hiệu lực', 409);
        }
        const session = await tx.parkingSession.create({
          data: {
            reservationId: input.reservationId ?? null,
            vehicleId: input.vehicleId ?? null,
            licensePlateIn: input.licensePlate,
            entryImageUrl:
              pbmsPick(input.dto, 'entryImageUrl', 'EntryImageUrl').trim() ||
              null,
            driverEntryImageUrl:
              pbmsPick(
                input.dto,
                'driverEntryImageUrl',
                'DriverEntryImageUrl',
              ).trim() || null,
            vehicleTypeId: input.vehicleTypeId,
            entryTime: new Date(),
            entryGateId: input.gate.id,
            assignedSlotId: slotId,
            actualSlotId: slotId,
            status: 'Active',
          },
        });
        if (input.entryPassId)
          await tx.entryPass.update({
            where: { id: input.entryPassId },
            data: { sessionId: session.id },
          });
        return session;
      });
    } catch (error) {
      if (error instanceof PbmsResponseDto) return error;
      throw error;
    }
    const [slot, gate] = await Promise.all([
      created.actualSlotId
        ? this.prisma.parkingSlot.findUnique({
            where: { id: created.actualSlotId },
            select: { slotCode: true, parkingId: true, floor: { select: { floorName: true } } },
          })
        : null,
      this.prisma.gate.findUnique({ where: { id: created.entryGateId }, select: { gateName: true } }),
    ]).catch(() => [null, null] as const);
    const where = slot ? `, ô ${slot.slotCode} (${slot.floor.floorName})` : '';
    await this.notifications
      ?.notifyPlateOwner(created.licensePlateIn, {
        title: slot ? `Xe đã vào bãi, ô ${slot.slotCode}` : 'Xe đã vào bãi',
        message: `Xe ${created.licensePlateIn} vào bãi lúc ${formatTime(created.entryTime)}${where}. Bấm để xem đường tới ô.`,
        type: 'parking',
        metadata: {
          sessionId: created.id,
          action: 'lot-map',
          slotCode: slot?.slotCode ?? null,
          parkingId: slot?.parkingId ?? null,
          entryGateName: gate?.gateName ?? null,
        },
      })
      .catch(() =>
        Logger.warn(
          'Không gửi được thông báo sau check-in',
          'ParkingOperationsService',
        ),
      );
    return created;
  }

  private async findAvailableSlot(
    tx: Prisma.TransactionClient,
    vehicleTypeId: string,
    floorId: string,
    parkingId: string,
    isResident: boolean,
  ) {
    const preferred = await tx.parkingSlot.findFirst({
      where: {
        vehicleTypeId,
        floorId,
        parkingId,
        status: 'Available',
        floor: { isResident },
      },
    });
    if (preferred) {
      return preferred;
    }
    return tx.parkingSlot.findFirst({
      where: {
        vehicleTypeId,
        parkingId,
        status: 'Available',
        floor: { isResident },
      },
    });
  }

  private async closeSession(sessionId: string, assignedFixedSlotId: string | null): Promise<void> {
    const session = await this.prisma.parkingSession.findUnique({
      where: { id: sessionId },
      include: { vehicle: { select: { userId: true } } },
    });
    if (!session) {
      return;
    }
    await this.prisma.parkingSession.update({
      where: { id: sessionId },
      data: { status: 'Completed' },
    });
    if (session.actualSlotId) {
      await this.prisma.parkingSlot.update({
        where: { id: session.actualSlotId },
        data: { status: assignedFixedSlotId === session.actualSlotId ? 'Assigned' : 'Available' },
      });
    }
    if (session.reservationId) {
      await this.prisma.reservation.update({
        where: { id: session.reservationId },
        data: { status: 'Completed' },
      });
    }
    const note = {
      title: 'Xe đã rời bãi',
      message: `Xe ${session.licensePlateIn} đã ra khỏi bãi lúc ${formatTime(session.exitTime ?? new Date())}.`,
      type: 'parking' as const,
      metadata: { sessionId: session.id },
    };
    if (session.vehicle?.userId) {
      await this.notifications?.notify(session.vehicle.userId, note);
    } else {
      await this.notifications?.notifyPlateOwner(session.licensePlateIn, note);
    }
  }

  private async calculateFee(session: { id: string; licensePlateIn: string; vehicleTypeId: string; entryTime: Date; reservationId: string | null }, exitTime: Date) {
    const policy = await this.prisma.pricingPolicy.findFirst({
      where: {
        vehicleTypeId: session.vehicleTypeId,
        status: 'Active',
        effectiveDate: { lte: exitTime },
      },
      orderBy: { effectiveDate: 'desc' },
    });
    if (!policy) {
      return PbmsResponseDto.fail('Chưa cấu hình chính sách giá active cho loại phương tiện này');
    }
    const totalHours = Math.max(0, (exitTime.getTime() - session.entryTime.getTime()) / 36e5);
    const billedHours = Math.max(1, Math.ceil(totalHours));
    let amount = Number(policy.basePrice);
    const nightSurchargeCount =
      Number(policy.nightSurcharge) > 0 ? this.countNightSurcharges(session.entryTime, exitTime) : 0;
    if (billedHours > policy.baseHours) {
      amount += (billedHours - policy.baseHours) * Number(policy.extraHourPrice);
    }
    if (nightSurchargeCount > 0) {
      amount += nightSurchargeCount * Number(policy.nightSurcharge);
    }
    const grossAmount = amount;
    let depositAmount = 0;
    if (session.reservationId) {
      const deposits = await this.prisma.payment.aggregate({
        where: {
          reservationId: session.reservationId,
          paymentType: 'Deposit',
          paymentStatus: 'Success',
        },
        _sum: { amount: true },
      });
      depositAmount = Math.min(grossAmount, Number(deposits._sum.amount ?? 0));
      amount = Math.max(0, grossAmount - depositAmount);
    }
    return {
      sessionId: session.id,
      licensePlate: session.licensePlateIn,
      entryTime: session.entryTime,
      exitTime,
      totalHours: Math.round(totalHours * 100) / 100,
      billedHours,
      grossAmount,
      depositAmount,
      amount,
      pricingPolicyId: policy.id,
      basePrice: Number(policy.basePrice),
      baseHours: policy.baseHours,
      extraHourPrice: Number(policy.extraHourPrice),
      nightSurcharge: Number(policy.nightSurcharge),
      nightSurchargeCount,
      hasNightSurcharge: nightSurchargeCount > 0,
      isCoveredBySubscription: false,
    };
  }

  private countNightSurcharges(entryTime: Date, exitTime: Date): number {
    if (exitTime <= entryTime) {
      return 0;
    }
    let nightCount = 0;
    for (let utcDate = new Date(Date.UTC(entryTime.getUTCFullYear(), entryTime.getUTCMonth(), entryTime.getUTCDate())); utcDate <= exitTime; utcDate = new Date(utcDate.getTime() + 86400000)) {
      const nightStartUtc = new Date(utcDate.getTime() + 15 * 3600000);
      const nightEndUtc = new Date(utcDate.getTime() + 23 * 3600000);
      if (entryTime < nightEndUtc && exitTime > nightStartUtc) {
        nightCount += 1;
      }
    }
    return nightCount;
  }

  private async resolveGate(gateId: string, type: 'Entry' | 'Exit') {
    if (isEmptyGuid(gateId)) {
      return { error: PbmsResponseDto.fail('Vui lòng chọn cổng') };
    }
    const gate = await this.prisma.gate.findUnique({ where: { id: gateId }, include: { floor: true } });
    if (!gate) {
      return { error: PbmsResponseDto.fail('Không tìm thấy cổng', 404) };
    }
    if (!sameStatus(gate.gateType, type)) {
      return { error: PbmsResponseDto.fail(`Cổng phải là loại ${type}`) };
    }
    return { gate };
  }

  /** Mã chữ trên thẻ gửi xe một lần → mã QR tương ứng (chỉ mã còn hiệu lực). */
  private async entryPassByShortCode(code: string) {
    const passes = await this.prisma.entryPass.findMany({
      where: { code, status: 'Active', expiresAt: { gt: new Date() } },
      select: { id: true, code: true },
      take: 2,
    });
    if (passes.length !== 1) {
      return PbmsResponseDto.fail(
        passes.length === 0
          ? 'Mã vào bãi không đúng hoặc đã hết hiệu lực'
          : 'Mã vào bãi bị trùng, vui lòng quét mã QR hoặc đọc biển số',
        404,
      );
    }
    return { passId: passes[0].id, code: passes[0].code };
  }

  private async resolveSessionId(dto: object): Promise<string | PbmsResponseDto> {
    const direct = pbmsPickGuid(dto, 'sessionId', 'SessionId');
    if (direct) {
      return direct;
    }
    // Nhân viên gõ tay mã ra cổng 6 ký tự của khách đã trả trước.
    const exitCode = parseShortGateCode(pbmsPick(dto, 'qrPayload', 'QrPayload'));
    if (exitCode) {
      const sessions = await this.prisma.parkingSession.findMany({
        where: { exitPassCode: exitCode, status: 'Active' },
        select: { id: true },
        take: 2,
      });
      if (sessions.length === 1) {
        return sessions[0].id;
      }
      return PbmsResponseDto.fail(
        sessions.length === 0
          ? 'Mã ra cổng không đúng hoặc xe đã ra khỏi bãi'
          : 'Mã ra cổng bị trùng, vui lòng quét mã QR hoặc đọc biển số',
        404,
      );
    }
    const fromQr = extractGuidFromQrPayload(pbmsPick(dto, 'qrPayload', 'QrPayload'));
    if (fromQr) {
      return fromQr;
    }
    const plate = normalizeLicensePlate(pbmsPick(dto, 'licensePlate', 'LicensePlate'));
    if (plate) {
      const session = await this.prisma.parkingSession.findFirst({
        where: { licensePlateIn: plate, status: 'Active' },
        orderBy: { entryTime: 'desc' },
      });
      if (session) {
        return session.id;
      }
    }
    return PbmsResponseDto.fail('Vui lòng quét mã vé gửi xe hoặc gửi QrPayload');
  }

  private async resolveQr(payload: string) {
    const entry = parseEntryPassPayload(payload);
    if (entry) {
      const pass = await this.prisma.entryPass.findUnique({
        where: { id: entry.passId },
        include: { vehicle: true },
      });
      if (!pass || pass.code !== entry.code) {
        return PbmsResponseDto.fail('Mã vào bãi không hợp lệ', 404);
      }
      return {
        reservationId: null,
        sessionId: pass.sessionId,
        codeType: 'EntryPass',
        entryPassId: pass.id,
        entryPassStatus: effectiveEntryPassStatus(pass),
        licensePlate: pass.vehicle.licensePlate,
        vehicleTypeId: pass.vehicle.vehicleTypeId,
      };
    }
    const id = extractGuidFromQrPayload(payload);
    if (!id) {
      return PbmsResponseDto.fail('Mã QR không chứa GUID hợp lệ');
    }
    const reservationExists = !!(await this.prisma.reservation.findUnique({ where: { id } }));
    const sessionExists = !!(await this.prisma.parkingSession.findUnique({ where: { id } }));
    if (!reservationExists && !sessionExists) {
      return PbmsResponseDto.fail('Mã QR không khớp mã đặt chỗ hoặc vé gửi xe', 404);
    }
    const codeType =
      reservationExists && sessionExists ? 'SessionAndReservation' : sessionExists ? 'Session' : 'Reservation';
    return {
      reservationId: reservationExists ? id : null,
      sessionId: sessionExists ? id : null,
      codeType,
    };
  }

  private async decodeQrBuffer(buffer: Buffer): Promise<string | null> {
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    return code?.data ?? null;
  }

  /**
   * Vé tháng còn hiệu lực của xe tại bãi [parkingId]: vé của chính bãi đó, vé gói mọi bãi,
   * hoặc vé cũ chưa gắn bãi. parkingId undefined: không lọc theo bãi.
   */
  private async activeSubscription(plate: string, vehicleTypeId: string, at: Date, parkingId?: string | null) {
    return this.prisma.monthlySubscription.findFirst({
      where: {
        vehicle: { is: { licensePlate: plate, vehicleTypeId } },
        status: 'Active',
        startDate: { lte: at },
        endDate: { gte: at },
        ...this.validAtParking(parkingId),
      },
    });
  }

  private validAtParking(parkingId?: string | null): Prisma.MonthlySubscriptionWhereInput {
    if (!parkingId) return {};
    return { OR: [{ parkingId }, { parkingId: null }, { package: { is: { allParkings: true } } }] };
  }

  /** Bãi của một cổng (cổng thuộc tầng, tầng thuộc bãi). */
  private async parkingOfGate(gate: { floorId: string } | string | null | undefined): Promise<string | null> {
    if (!gate) return null;
    if (typeof gate === 'string') {
      const g = await this.prisma.gate.findUnique({
        where: { id: gate },
        select: { floor: { select: { parkingId: true } } },
      });
      return g?.floor.parkingId ?? null;
    }
    const floor = await this.prisma.floor.findUnique({ where: { id: gate.floorId }, select: { parkingId: true } });
    return floor?.parkingId ?? null;
  }

  private async assertOwner(sessionId: string, userId: string) {
    if (isEmptyGuid(sessionId) || isEmptyGuid(userId)) {
      return PbmsResponseDto.fail('Thông tin phiên gửi xe không hợp lệ');
    }
    const session = await this.prisma.parkingSession.findUnique({
      where: { id: sessionId },
      include: { vehicle: { select: { userId: true } } },
    });
    if (!session) {
      return PbmsResponseDto.fail('Không tìm thấy phiên gửi xe', 404);
    }
    if (session.vehicle?.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền xem phiên gửi xe này', 403);
    }
    return null;
  }

  private async findCheckoutPayment(paymentId: string) {
    if (isEmptyGuid(paymentId)) {
      return PbmsResponseDto.fail('PaymentId không hợp lệ');
    }
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || !sameStatus(payment.paymentType ?? '', 'CheckoutFee') || !payment.sessionId) {
      return PbmsResponseDto.fail('Không tìm thấy thanh toán checkout', 404);
    }
    return payment;
  }

  private async loadSession(id: string) {
    const item = await this.prisma.parkingSession.findUnique({
      where: { id },
      include: {
        vehicle: { include: { user: true } },
        vehicleType: true,
        entryGate: true,
        exitGate: true,
        assignedSlot: true,
        actualSlot: true,
        payments: { orderBy: { paymentTime: 'desc' }, take: 1 },
      },
    });
    if (!item) {
      return null;
    }
    const mapped = await this.sessions.map(item);
    if (sameStatus(item.status, 'Active')) {
      mapped.ticket = await createTicket(item.id);
    }
    return mapped;
  }

  private mapPayment(
    payment: {
      id: string;
      sessionId: string | null;
      reservationId: string | null;
      amount: Prisma.Decimal;
      paymentMethod: string;
      paymentType: string | null;
      paymentTime: Date;
      paymentStatus: string;
      transactionReference: string | null;
    },
    orderCode?: string,
  ) {
    return {
      paymentId: payment.id,
      sessionId: payment.sessionId,
      reservationId: payment.reservationId,
      amount: toMoney(payment.amount),
      paymentMethod: payment.paymentMethod,
      paymentType: payment.paymentType,
      paymentTime: payment.paymentTime,
      paymentStatus: payment.paymentStatus,
      transactionReference: orderCode ?? payment.transactionReference,
    };
  }

  private normalizeCustomer(value: string): 'Guest' | 'Resident' | 'Reservation' | null {
    const v = value.trim().toLowerCase();
    if (v === 'guest') return 'Guest';
    if (v === 'resident') return 'Resident';
    if (v === 'reservation') return 'Reservation';
    return null;
  }

  private normalizeMethod(value: string): 'PayOS' | 'Cash' | null {
    const v = value.trim().toLowerCase();
    if (v === 'payos') return 'PayOS';
    if (v === 'cash') return 'Cash';
    return null;
  }
}
