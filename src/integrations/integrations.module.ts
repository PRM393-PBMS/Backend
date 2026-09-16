import { Global, Module } from '@nestjs/common';
import { FilesService, PayosService } from './payos-files.service';
import { PlateRecognizerService } from './plate-recognizer.service';

@Global()
@Module({
  providers: [FilesService, PayosService, PlateRecognizerService],
  exports: [FilesService, PayosService, PlateRecognizerService],
})
export class IntegrationsModule {}
