import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { isEmptyGuid, pbmsPick, sameStatus } from '../common/pbms-fields';
import { NotificationsService } from '../notifications/notifications.service';
import {
  decodeSignaturePng,
  loadSealKey,
  sealPayload,
  sha256Hex,
  readSealKey,
  sealKeyProblemMessage,
  signSeal,
  verifySeal,
} from '../common/contract-seal';

type Tx = Prisma.TransactionClient;

const operatorName = () => process.env.CONTRACT_OPERATOR_NAME?.trim() || 'Ban quản lý Bãi đỗ xe PBMS';

const vnDate = (d: Date) =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);

const vnMoney = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} đồng`;

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** Tạo hợp đồng chờ ký cho một đăng ký vé dài hạn (gọi trong giao dịch đăng ký). */
  async createForSubscription(tx: Tx, subscriptionId: string) {
    const sub = await tx.monthlySubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: {
        user: true,
        package: true,
        vehicle: { include: { vehicleType: true } },
        fixedSlot: { include: { floor: true } },
      },
    });
    const now = new Date();
    const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
    const contractNumber = `HD-${ymd}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const content = this.buildContent({
      contractNumber,
      createdAt: now,
      customerName: sub.user.fullName ?? sub.user.userName ?? sub.user.email,
      customerEmail: sub.user.email,
      customerPhone: sub.user.phoneNumber,
      licensePlate: sub.vehicle.licensePlate,
      vehicleType: sub.vehicle.vehicleType.typeName,
      packageName: sub.package.packageName,
      durationMonths: sub.package.durationMonths,
      price: Number(sub.price),
      startDate: sub.startDate,
      endDate: sub.endDate,
      fixedSlot: sub.fixedSlot ? `${sub.fixedSlot.slotCode} (${sub.fixedSlot.floor.floorName})` : null,
    });
    return tx.subscriptionContract.create({
      data: {
        subscriptionId,
        userId: sub.userId,
        contractNumber,
        content,
        contentHash: sha256Hex(content),
      },
    });
  }

  private buildContent(d: {
    contractNumber: string;
    createdAt: Date;
    customerName: string;
    customerEmail: string;
    customerPhone: string | null;
    licensePlate: string;
    vehicleType: string;
    packageName: string;
    durationMonths: number;
    price: number;
    startDate: Date;
    endDate: Date;
    fixedSlot: string | null;
  }): string {
    return [
      'CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM',
      'Độc lập - Tự do - Hạnh phúc',
      '',
      'HỢP ĐỒNG DỊCH VỤ GỬI XE THEO THÁNG',
      `Số: ${d.contractNumber}`,
      `Lập ngày ${vnDate(d.createdAt)}, ký điện tử trên ứng dụng PBMS.`,
      '',
      `BÊN A (Bên cung cấp dịch vụ): ${operatorName()}`,
      `BÊN B (Khách hàng): ${d.customerName}`,
      `Email: ${d.customerEmail}`,
      `Số điện thoại: ${d.customerPhone ?? 'Chưa cung cấp'}`,
      '',
      'ĐIỀU 1. PHƯƠNG TIỆN VÀ GÓI DỊCH VỤ',
      `1.1. Biển kiểm soát: ${d.licensePlate}. Loại xe: ${d.vehicleType}.`,
      `1.2. Gói dịch vụ: ${d.packageName}, thời hạn ${d.durationMonths} tháng.`,
      `1.3. Hiệu lực từ ngày ${vnDate(d.startDate)} đến hết ngày ${vnDate(d.endDate)} kể từ khi thanh toán thành công.`,
      `1.4. Vị trí đỗ: ${d.fixedSlot ?? 'không cố định, theo sắp xếp của Bên A'}.`,
      '',
      'ĐIỀU 2. GIÁ VÀ THANH TOÁN',
      `2.1. Tổng giá trị hợp đồng: ${vnMoney(d.price)}, đã bao gồm thuế (nếu có).`,
      '2.2. Bên B thanh toán một lần qua cổng PayOS ngay sau khi ký. Hợp đồng chỉ có hiệu lực khi Bên A ghi nhận thanh toán thành công.',
      '',
      'ĐIỀU 3. QUYỀN VÀ NGHĨA VỤ CỦA BÊN A',
      '3.1. Cho phép phương tiện tại Điều 1 ra vào bãi không giới hạn số lượt trong thời hạn hợp đồng, nhận diện bằng biển số tại cổng.',
      '3.2. Bảo đảm an ninh, camera giám sát và tiếp nhận báo cáo sự cố trên ứng dụng.',
      '3.3. Thông báo cho Bên B trước khi hợp đồng hết hạn.',
      '',
      'ĐIỀU 4. QUYỀN VÀ NGHĨA VỤ CỦA BÊN B',
      '4.1. Chỉ sử dụng dịch vụ cho đúng phương tiện đã đăng ký; đổi biển số phải gửi yêu cầu và được Bên A duyệt.',
      '4.2. Tuân thủ nội quy bãi đỗ, không để tài sản có giá trị trên xe.',
      '4.3. Cung cấp thông tin chính xác và chịu trách nhiệm về thông tin đã cung cấp.',
      '',
      'ĐIỀU 5. CHẤM DỨT HỢP ĐỒNG',
      '5.1. Hợp đồng chấm dứt khi hết thời hạn hoặc khi một bên huỷ trên ứng dụng.',
      '5.2. Khi Bên B huỷ trước hạn, khoản đã thanh toán được xử lý theo chính sách hoàn tiền công bố tại bãi tại thời điểm huỷ.',
      '',
      'ĐIỀU 6. HÌNH THỨC KÝ KẾT',
      '6.1. Hai bên thống nhất giao kết hợp đồng bằng phương tiện điện tử theo Luật Giao dịch điện tử. Bên B ký bằng chữ ký điện tử (chữ ký tay trên thiết bị, sau khi xác thực tài khoản và thiết bị).',
      '6.2. Bên A niêm phong hợp đồng đã ký bằng chữ ký mã hoá ECDSA trên mã băm SHA-256 của toàn bộ nội dung và chữ ký của Bên B. Mọi thay đổi sau khi ký đều bị phát hiện khi kiểm tra niêm phong.',
    ].join('\n');
  }

  private map(c: {
    id: string;
    subscriptionId: string;
    contractNumber: string;
    content: string;
    contentHash: string;
    status: string;
    signerName: string | null;
    signatureImage: string | null;
    signedAt: Date | null;
    sealKeyId: string | null;
    createdAt: Date;
  }) {
    return {
      contractId: c.id,
      subscriptionId: c.subscriptionId,
      contractNumber: c.contractNumber,
      content: c.content,
      contentHash: c.contentHash,
      status: c.status,
      signerName: c.signerName,
      signatureImage: c.signatureImage ? `data:image/png;base64,${c.signatureImage}` : null,
      signedAt: c.signedAt,
      sealKeyId: c.sealKeyId,
      createdAt: c.createdAt,
    };
  }

  private canManage(role: string) {
    const v = role.trim().toLowerCase();
    return v === 'manager' || v === 'admin' || v === 'staff' || v === 'admin,admin';
  }

  async getForSubscription(subscriptionId: string, userId: string, role: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(subscriptionId)) {
      return PbmsResponseDto.fail('SubscriptionId không hợp lệ');
    }
    const c = await this.prisma.subscriptionContract.findUnique({ where: { subscriptionId } });
    if (!c) {
      return PbmsResponseDto.fail('Gói này không có hợp đồng', 404);
    }
    if (c.userId !== userId && !this.canManage(role)) {
      return PbmsResponseDto.fail('Bạn không có quyền xem hợp đồng này', 403);
    }
    return PbmsResponseDto.ok('Lấy hợp đồng thành công', this.map(c));
  }

  async getMine(userId: string): Promise<PbmsResponseDto> {
    const items = await this.prisma.subscriptionContract.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return PbmsResponseDto.ok('Lấy danh sách hợp đồng thành công', items.map((c) => this.map(c)));
  }

  /**
   * Bên B ký. Trả về hợp đồng đã ký; controller sẽ tạo thanh toán ngay sau đó.
   * Ký lại một hợp đồng đã ký là no-op (để client gọi lại an toàn khi mất mạng).
   */
  async sign(contractId: string, userId: string, dto: object, signerIp: string | null): Promise<PbmsResponseDto> {
    if (isEmptyGuid(contractId)) {
      return PbmsResponseDto.fail('ContractId không hợp lệ');
    }
    const c = await this.prisma.subscriptionContract.findUnique({
      where: { id: contractId },
      include: { subscription: true },
    });
    if (!c) {
      return PbmsResponseDto.fail('Không tìm thấy hợp đồng', 404);
    }
    if (c.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền ký hợp đồng này', 403);
    }
    if (sameStatus(c.status, 'Signed')) {
      return PbmsResponseDto.ok('Hợp đồng đã được ký trước đó', this.map(c));
    }
    if (!sameStatus(c.status, 'PendingSignature') || !sameStatus(c.subscription.status, 'PendingPayment')) {
      return PbmsResponseDto.fail('Hợp đồng không còn ở trạng thái chờ ký', 409);
    }
    const agreed = (dto as Record<string, unknown>).agreed ?? (dto as Record<string, unknown>).Agreed;
    if (agreed !== true && String(agreed).toLowerCase() !== 'true') {
      return PbmsResponseDto.fail('Vui lòng xác nhận đã đọc và đồng ý các điều khoản');
    }
    if (pbmsPick(dto, 'contentHash', 'ContentHash').trim() !== c.contentHash) {
      return PbmsResponseDto.fail('Nội dung hợp đồng đã thay đổi, vui lòng tải lại trước khi ký', 409);
    }
    const signerName = pbmsPick(dto, 'signerName', 'SignerName').trim().slice(0, 100);
    if (signerName.length < 2) {
      return PbmsResponseDto.fail('Vui lòng nhập họ tên người ký');
    }
    const png = decodeSignaturePng(pbmsPick(dto, 'signatureImage', 'SignatureImage'));
    if (!png) {
      return PbmsResponseDto.fail('Chữ ký không hợp lệ (ảnh PNG, tối đa 200KB)');
    }
    const sealKey = readSealKey();
    if (!sealKey.key) {
      this.logger.error(`Không ký được hợp đồng ${c.contractNumber}: ${sealKeyProblemMessage(sealKey.problem)}`);
      return PbmsResponseDto.fail(sealKeyProblemMessage(sealKey.problem), 503);
    }
    const key = sealKey.key;
    const signedAt = new Date();
    const signatureImageHash = sha256Hex(png);
    const seal = signSeal(
      sealPayload({ contractNumber: c.contractNumber, contentHash: c.contentHash, signatureImageHash, signedAt, userId }),
      key,
    );
    // Cập nhật có điều kiện: hai lần bấm ký song song chỉ ghi nhận một lần.
    const moved = await this.prisma.subscriptionContract.updateMany({
      where: { id: c.id, status: 'PendingSignature' },
      data: {
        status: 'Signed',
        signerName,
        signatureImage: png.toString('base64'),
        signatureImageHash,
        signedAt,
        signerIp: signerIp?.slice(0, 45) ?? null,
        seal,
        sealKeyId: key.keyId,
      },
    });
    const fresh = await this.prisma.subscriptionContract.findUniqueOrThrow({ where: { id: c.id } });
    if (moved.count === 1) {
      await this.notifications?.notify(userId, {
        title: 'Đã ký hợp đồng vé tháng',
        message: `Hợp đồng ${c.contractNumber} đã được ký và niêm phong số. Thanh toán để kích hoạt vé.`,
        type: 'subscription',
        metadata: { contractId: c.id, subscriptionId: c.subscriptionId },
      });
    }
    return PbmsResponseDto.ok(
      moved.count === 1 ? 'Ký hợp đồng thành công' : 'Hợp đồng đã được ký trước đó',
      this.map(fresh),
    );
  }

  /** Kiểm tra hợp đồng: nội dung còn nguyên vẹn và niêm phong hợp lệ. */
  async verify(contractId: string, userId: string, role: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(contractId)) {
      return PbmsResponseDto.fail('ContractId không hợp lệ');
    }
    const c = await this.prisma.subscriptionContract.findUnique({ where: { id: contractId } });
    if (!c) {
      return PbmsResponseDto.fail('Không tìm thấy hợp đồng', 404);
    }
    if (c.userId !== userId && !this.canManage(role)) {
      return PbmsResponseDto.fail('Bạn không có quyền kiểm tra hợp đồng này', 403);
    }
    const contentIntact = sha256Hex(c.content) === c.contentHash;
    let signatureIntact = false;
    let sealValid = false;
    let keyMatches = false;
    if (sameStatus(c.status, 'Signed') && c.signatureImage && c.signedAt && c.seal) {
      signatureIntact = sha256Hex(Buffer.from(c.signatureImage, 'base64')) === c.signatureImageHash;
      const key = loadSealKey();
      keyMatches = !!key && key.keyId === c.sealKeyId;
      if (key && keyMatches) {
        sealValid = verifySeal(
          sealPayload({
            contractNumber: c.contractNumber,
            contentHash: sha256Hex(c.content),
            signatureImageHash: sha256Hex(Buffer.from(c.signatureImage, 'base64')),
            signedAt: c.signedAt,
            userId: c.userId,
          }),
          c.seal,
          key.publicKey,
        );
      }
    }
    return PbmsResponseDto.ok('Kiểm tra hợp đồng thành công', {
      contractId: c.id,
      contractNumber: c.contractNumber,
      status: c.status,
      valid: contentIntact && signatureIntact && sealValid,
      contentIntact,
      signatureIntact,
      sealValid,
      keyMatches,
      sealKeyId: c.sealKeyId,
      signedAt: c.signedAt,
    });
  }

  /** Khoá công khai để bên thứ ba tự kiểm tra niêm phong. */
  publicKey(): PbmsResponseDto {
    const sealKey = readSealKey();
    if (!sealKey.key) {
      return PbmsResponseDto.fail(sealKeyProblemMessage(sealKey.problem), 503);
    }
    const key = sealKey.key;
    return PbmsResponseDto.ok('Lấy khoá công khai thành công', {
      keyId: key.keyId,
      algorithm: 'ECDSA P-256 SHA-256',
      publicKeyPem: key.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      payloadFormat: 'PBMS-CONTRACT|v1|contractNumber|sha256(content)|sha256(signaturePng)|signedAtISO|userId',
    });
  }

}
