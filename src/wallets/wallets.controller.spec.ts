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

  it('công bố mô tả tiếng Việt cho các path ví', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    hideLegacyPascalCaseProperties(document);

    const getWallet = document.paths['/api/wallet']?.get;
    const postTopUp = document.paths['/api/wallet/top-up']?.post;

    expect(getWallet?.summary).toContain('Số dư ví');
    expect(getWallet?.description).toContain('walletBalance');
    expect(getWallet?.description).toContain('Vui lòng đăng nhập');
    expect(postTopUp?.description).toContain('paymentUrl');
    expect(postTopUp?.description).toContain('payos-webhook');
    expect(document.paths['/api/wallet/transactions']?.get?.description).toContain('TopUp');
    expect(document.paths['/api/wallet/top-ups']?.get?.description).toContain('Credit');
    expect(document.paths['/api/wallet/spends']?.get?.description).toContain('Debit');
  });
});
