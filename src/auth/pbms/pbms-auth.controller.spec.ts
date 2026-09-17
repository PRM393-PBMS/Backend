import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { App } from 'supertest/types';
import { PbmsResponseDto } from '../../common/dto/pbms-response.dto';
import { PbmsAuthController } from './pbms-auth.controller';
import { PbmsAuthService } from './pbms-auth.service';
import { hideLegacyPascalCaseProperties } from '../../common/swagger/hide-legacy-pascal-case-properties';

describe('PbmsAuthController', () => {
  let app: INestApplication<App>;
  const pbmsAuthService = {
    login: jest.fn(),
    sendRegisterOtp: jest.fn(),
    verifyRegisterOtp: jest.fn(),
    requestResetPasswordOtp: jest.fn(),
    verifyResetPasswordOtp: jest.fn(),
    refreshToken: jest.fn(),
    logout: jest.fn(),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PbmsAuthController],
      providers: [{ provide: PbmsAuthService, useValue: pbmsAuthService }],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  it('Swagger chỉ có tag PBMS Auth, không có Authentication hay /auth/*', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    hideLegacyPascalCaseProperties(document);
    expect(document.paths['/auth/login']).toBeUndefined();
    expect(document.paths['/auth/register']).toBeUndefined();
    expect(document.paths['/auth/me']).toBeUndefined();
    expect(document.paths['/api/Auth/login']?.post).toBeDefined();
    expect(document.paths['/api/Auth/login']?.post?.tags).toEqual(['PBMS Auth']);
    const tagNames = Object.values(document.paths ?? {}).flatMap((pathItem) =>
      Object.values(pathItem ?? {}).flatMap((op) =>
        op && typeof op === 'object' && 'tags' in op ? (op.tags ?? []) : [],
      ),
    );
    expect(tagNames).not.toContain('Authentication');
    expect(tagNames).toContain('PBMS Auth');
  });

  it('Swagger chỉ công bố field camelCase cho login PBMS', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    hideLegacyPascalCaseProperties(document);

    const loginSchema = document.components?.schemas?.PbmsLoginDto;

    expect(loginSchema).toHaveProperty('properties.email');
    expect(loginSchema).toHaveProperty('properties.password');
    expect(loginSchema).not.toHaveProperty('properties.Email');
    expect(loginSchema).not.toHaveProperty('properties.Password');
  });

  it('Swagger register DTO dùng example đăng ký thật, không generic string', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    hideLegacyPascalCaseProperties(document);

    const registerSchema = document.components?.schemas?.PbmsRegisterDto;
    expect(registerSchema && 'properties' in registerSchema ? registerSchema.properties : undefined).toMatchObject({
      userName: { example: 'fonfon' },
      fullName: { example: 'Huỳnh Dũng Phong' },
      email: { example: 'fonHocPRM393@gmail.com' },
      phoneNumber: { example: '0123456789' },
      password: { example: 'passcuafon@123' },
      confirmPassword: { example: 'passcuafon@123' },
    });

    const sendOtp = document.paths['/api/Auth/send-register-otp']?.post;
    const example =
      sendOtp?.requestBody && 'content' in sendOtp.requestBody
        ? sendOtp.requestBody.content?.['application/json']?.examples?.default
        : undefined;
    expect(example && 'value' in example ? example.value : undefined).toEqual({
      userName: 'fonfon',
      fullName: 'Huỳnh Dũng Phong',
      email: 'fonHocPRM393@gmail.com',
      phoneNumber: '0123456789',
      password: 'passcuafon@123',
      confirmPassword: 'passcuafon@123',
    });

    const loginOk = document.paths['/api/Auth/login']?.post?.responses?.['200'];
    const loginExample =
      loginOk && 'content' in loginOk
        ? loginOk.content?.['application/json']?.schema &&
          'example' in loginOk.content['application/json'].schema
          ? loginOk.content['application/json'].schema.example
          : undefined
        : undefined;
    expect(loginExample).toMatchObject({
      statusCode: 200,
      isSuccess: true,
      result: { user: { userName: 'fonfon', email: 'fonHocPRM393@gmail.com' } },
    });
  });

  it('POST /api/Auth/login trả envelope {statusCode,message,isSuccess,result}', async () => {
    pbmsAuthService.login.mockResolvedValue(
      new PbmsResponseDto('Đăng nhập thành công', 200, true, {
        accessToken: 'at',
        refreshToken: 'rt',
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/api/Auth/login')
      .send({ email: 'a@example.com', password: 'secret12' })
      .expect(200);

    expect(response.body).toMatchObject({
      statusCode: 200,
      message: 'Đăng nhập thành công',
      isSuccess: true,
      result: { accessToken: 'at', refreshToken: 'rt' },
    });
  });

  it('POST /auth/login không còn trên public API', async () => {
    await request(app.getHttpServer()).post('/auth/login').send({}).expect(404);
  });
});
