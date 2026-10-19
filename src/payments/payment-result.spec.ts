import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PayosService } from '../integrations/payos-files.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { appDeepLink, renderPaymentResultPage } from './payment-result.page';
import { PaymentsService } from './payments.service';

describe('Trang kết quả PayOS', () => {
  let service: PaymentsService;
  let findFirst: jest.Mock;

  beforeEach(async () => {
    findFirst = jest.fn().mockResolvedValue({
      id: 'pay-1',
      amount: new Prisma.Decimal(50000),
      paymentType: 'WalletTopUp',
      paymentStatus: 'Pending',
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: { payment: { findFirst } } },
        { provide: WalletsService, useValue: {} },
        { provide: PayosService, useValue: {} },
      ],
    }).compile();
    service = module.get(PaymentsService);
  });

  it('hỏi lại PayOS: đã trả thì hiện thành công kèm loại và số tiền', async () => {
    jest.spyOn(service, 'syncPayosPayment').mockResolvedValue('Success');
    const view = await service.resultForOrderCode('1729300000000', false);
    expect(view).toEqual({
      state: 'success',
      orderCode: '1729300000000',
      amount: 50000,
      typeLabel: 'Nạp ví PBMS',
    });
    expect(findFirst.mock.calls[0][0].where).toEqual({ transactionReference: '1729300000000', paymentMethod: 'PayOS' });
  });

  it('trang huỷ: thanh toán chuyển Failed thì báo đã huỷ', async () => {
    jest.spyOn(service, 'syncPayosPayment').mockResolvedValue('Failed');
    expect((await service.resultForOrderCode('1729300000000', true)).state).toBe('cancelled');
  });

  it('PayOS chưa xác nhận thì báo đang chờ; PayOS lỗi vẫn hiện trang', async () => {
    jest.spyOn(service, 'syncPayosPayment').mockRejectedValue(new Error('timeout'));
    expect((await service.resultForOrderCode('1729300000000', false)).state).toBe('pending');
  });

  it('mã đơn không hợp lệ thì không truy vấn', async () => {
    expect((await service.resultForOrderCode('abc<script>', false)).state).toBe('unknown');
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('HTML thoát ký tự đặc biệt và có link mở lại app', () => {
    const view = { state: 'success' as const, orderCode: '123', amount: 50000, typeLabel: '<b>x</b>' };
    const html = renderPaymentResultPage(view);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('50.000 đ');
    expect(appDeepLink(view)).toBe('pbms://payment-result?status=success&orderCode=123');
  });
});
