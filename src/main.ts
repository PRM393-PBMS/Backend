import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { mkdir } from 'fs/promises';
import { dirname, isAbsolute, resolve } from 'path';
import { AppModule } from './app.module';
import { loadEnvFile } from 'node:process';

async function bootstrap() {
  // Load local configuration before Nest constructs Prisma and JWT providers.
  // Hosted deployments can provide environment variables without an .env file.
  try {
    loadEnvFile();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const uploadDir = process.env.UPLOAD_DIR ?? './public/uploads';
  const uploadAbs = isAbsolute(uploadDir) ? uploadDir : resolve(process.cwd(), uploadDir);
  await mkdir(uploadAbs, { recursive: true });
  const publicRoot = dirname(uploadAbs);
  app.useStaticAssets(publicRoot, { prefix: '/' });

  // 1. Kích hoạt ValidationPipe toàn cục: whitelist strip trường lạ, transform tự động
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,            // Loại bỏ các trường không khai báo trong DTO (chống Mass Assignment)
      forbidNonWhitelisted: true, // Ném BadRequestException nếu client cố tình truyền trường lạ
      transform: true,            // Ép kiểu tự động theo class-transformer
    }),
  );

  // 2. Thiết lập Swagger OpenAPI Document
  const config = new DocumentBuilder()
    .setTitle('PRM393 Backend - PBMS REST API')
    .setDescription(
      'Tài liệu API backend Node. Hợp đồng `/api/*` theo envelope chuẩn và path trong docs/openapi-pbms-paths.md. Đăng nhập tại `/api/Auth`. Hồ sơ tại `/api/profile`.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT Access Token',
        description: 'Nhập JWT Access Token vào đây (ví dụ: eyJhbGciOi...)',
        in: 'header',
      },
      'JWT-auth',
    )
    .addServer(
      process.env.PUBLIC_API_URL?.trim() || '/',
      'API origin (cùng host với trang docs nếu để trống)',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 PRM393 Backend Application đang chạy tại: http://localhost:${port}`);
  console.log(`📚 Tài liệu Swagger UI: http://localhost:${port}/api/docs`);
}
void bootstrap();
