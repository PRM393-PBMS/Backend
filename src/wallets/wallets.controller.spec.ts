import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { App } from 'supertest/types';
import { hideLegacyPascalCaseProperties } from '../common/swagger/hide-legacy-pascal-case-properties';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

describe('WalletsController Swagger', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [WalletsController],
      providers: [{ provide: WalletsService, useValue: {} }],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('công bố mô tả tiếng Việt cho các path ví theo WalletId', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    hideLegacyPascalCaseProperties(document);

    const getWallet = document.paths['/api/wallet/{walletId}']?.get;
    const postTopUp = document.paths['/api/wallet/{walletId}/top-up']?.post;
    const postEnsure = document.paths['/api/wallet']?.post;

    expect(postEnsure?.summary).toContain('Mở ví');
    expect(getWallet?.summary).toContain('Số dư ví');
    expect(getWallet?.description).toContain('walletBalance');
    expect(getWallet?.description).toContain('Vui lòng đăng nhập');
    expect(getWallet?.description).toContain('Bạn không sở hữu ví này');
    expect(postTopUp?.description).toContain('paymentUrl');
    expect(postTopUp?.description).toContain('payos-webhook');
    expect(document.paths['/api/wallet/{walletId}/transactions']?.get?.description).toContain('TopUp');
    expect(document.paths['/api/wallet/{walletId}/top-ups']?.get?.description).toContain('Credit');
    expect(document.paths['/api/wallet/{walletId}/spends']?.get?.description).toContain('Debit');
  });
});
