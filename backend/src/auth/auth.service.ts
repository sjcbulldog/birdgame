import { Injectable, ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) {}

  async register(registerDto: RegisterDto) {
    const existingEmail = await this.usersService.findByEmail(registerDto.email);
    if (existingEmail) {
      throw new ConflictException('Email already exists');
    }

    const existingUsername = await this.usersService.findByUsername(registerDto.username);
    if (existingUsername) {
      throw new ConflictException('Username already exists');
    }

    const user = await this.usersService.create(
      registerDto.username,
      registerDto.email,
      registerDto.password,
      registerDto.firstName,
      registerDto.lastName,
    );

    // Generate verification token
    const verificationToken = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hours expiration

    await this.usersService.setEmailVerificationToken(user.id, verificationToken, expiresAt);

    // Send verification email
    await this.emailService.sendVerificationEmail(user.email, verificationToken);

    return {
      message: 'Registration successful. Please check your email to verify your account.',
      email: user.email,
    };
  }

  async login(loginDto: LoginDto) {
    // Try to find user by email or username
    let user = await this.usersService.findByEmail(loginDto.usernameOrEmail);
    if (!user) {
      user = await this.usersService.findByUsername(loginDto.usernameOrEmail);
    }
    
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await this.usersService.validatePassword(user, loginDto.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === 'pending') {
      throw new UnauthorizedException('Please verify your email address before logging in');
    }

    if (user.status === 'disabled') {
      throw new UnauthorizedException('This account has been disabled');
    }

    const payload = { email: user.email, sub: user.id };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType,
      },
    };
  }

  async verifyEmail(token: string) {
    const user = await this.usersService.verifyEmail(token);
    if (!user) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    return {
      message: 'Email verified successfully. You can now log in.',
    };
  }

  async resendVerification(usernameOrEmail: string) {
    // Try to find user by email or username
    let user = await this.usersService.findByEmail(usernameOrEmail);
    if (!user) {
      user = await this.usersService.findByUsername(usernameOrEmail);
    }
    
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.status === 'verified') {
      throw new BadRequestException('Email already verified');
    }

    // Generate new verification token
    const verificationToken = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hours expiration

    await this.usersService.setEmailVerificationToken(user.id, verificationToken, expiresAt);

    // Send verification email
    try {
      await this.emailService.sendVerificationEmail(user.email, verificationToken);
    } catch (error) {
      console.error('Error sending verification email:', error);
      throw new BadRequestException('Failed to send verification email. Please try again later.');
    }

    return {
      message: 'Verification email sent. Please check your inbox.',
    };
  }
}
