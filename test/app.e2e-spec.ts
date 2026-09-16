import { Test, TestingModule } from '@nestjs/testing';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppController } from '../src/app.controller';
import { AtGuard } from '../src/auth/common/guards/at.guard';
import { AtStrategy } from '../src/auth/strategies/at.strategy';

@Controller('protected-probe')
class ProtectedProbeController {
  @Get()
  get(): string { return 'protected'; }
}

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController, ProtectedProbeController],
      providers: [AtStrategy, { provide: APP_GUARD, useClass: AtGuard }],
    }).compile();

    app = moduleFixture.createNestApplication();
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    SwaggerModule.setup('api/docs', app, document);
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(302)
      .expect('Location', '/api/docs');
  });

  it('serves Swagger without a token', () => {
    return request(app.getHttpServer()).get('/api/docs/').expect(200);
  });

  it('serves health without a token', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });

  it('keeps non-public routes protected', () => {
    return request(app.getHttpServer()).get('/protected-probe').expect(401);
  });

  afterEach(async () => {
    await app.close();
  });
});
