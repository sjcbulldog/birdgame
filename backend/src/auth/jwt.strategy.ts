import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }
    
    // Check if user is banned
    if (user.userType === 'banned') {
      throw new UnauthorizedException('You have been banned from this site. Please contact support if you believe this is an error.');
    }
    
    // Check if user account is disabled
    if (user.status === 'disabled') {
      throw new UnauthorizedException('This account has been disabled');
    }
    
    return { userId: payload.sub, email: payload.email, userType: user.userType };
  }
}
