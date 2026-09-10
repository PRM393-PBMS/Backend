import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
// import { AppModule, ObserveInstrument } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  /*
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  */
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
