import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Add request logging middleware
  app.use((req: any, res: any, next: any) => {
    const timestamp = new Date().toISOString();
    const { method, originalUrl, ip } = req;
    console.log(`[${timestamp}] ${method} ${originalUrl} - IP: ${ip}`);
    
    // Log request body for POST/PUT/PATCH requests
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      console.log('  Body:', JSON.stringify(req.body));
    }
    
    // Log query parameters if present
    if (Object.keys(req.query).length > 0) {
      console.log('  Query:', JSON.stringify(req.query));
    }
    
    next();
  });
  
  // Enable CORS for development (when frontend runs separately)
  if (process.env.NODE_ENV !== 'production') {
    app.enableCors({
      origin: true, // Allow all origins in development
      credentials: true,
    });
  }
  
  // Enable validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  
  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0'); // Listen on all network interfaces
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Network access: http://<your-ip>:${port}`);
}
bootstrap();
