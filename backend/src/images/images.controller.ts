import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';

@Controller('api/images')
export class ImagesController {
  @Get('desk.png')
  getDeskImage(@Res() res: Response) {
    const imagePath = join(__dirname, '..', '..', 'images', 'desk.png');
    return res.sendFile(imagePath);
  }

  @Get('frame.png')
  getFrameImage(@Res() res: Response) {
    const imagePath = join(__dirname, '..', '..', 'images', 'frame.png');
    return res.sendFile(imagePath);
  }

  @Get('user.png')
  getUserImage(@Res() res: Response) {
    const imagePath = join(__dirname, '..', '..', 'images', 'user.png');
    return res.sendFile(imagePath);
  }
}
