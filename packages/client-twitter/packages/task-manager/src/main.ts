import { NestFactory } from '@nestjs/core';
import { TaskManagerModule } from './app.module.js';
import { taskManagerHttpServicePort } from './constant.js';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

export async function bootstrap() {
  const app = await NestFactory.create(TaskManagerModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const config = new DocumentBuilder()
    .setTitle('My API')
    .setDescription('My API description')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'X-ADMIN-API-KEY', in: 'header' }, 'X-ADMIN-API-KEY')
    .build();

  // await SwaggerModule.loadPluginMetadata(metadata);
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
  
  await app.listen(taskManagerHttpServicePort);
}
bootstrap();
