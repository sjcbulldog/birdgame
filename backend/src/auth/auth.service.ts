import { Injectable, ConflictException, UnauthorizedException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { HeartbeatService } from '../gateway/heartbeat.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailService: EmailService,
    @Inject(forwardRef(() => HeartbeatService))
    private heartbeatService: HeartbeatService,
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

    if (user.userType === 'banned') {
      throw new UnauthorizedException('You have been banned from this site. Please contact support if you believe this is an error.');
    }

    // Check if user is already logged in
    const activeHeartbeats = this.heartbeatService.getHeartbeatStatus();
    const isAlreadyLoggedIn = activeHeartbeats.some(hb => hb.userId === user.id);
    if (isAlreadyLoggedIn) {
      throw new UnauthorizedException('You cannot log in more than once to the site. Please log out from your other session first.');
    }

    const payload = { email: user.email, sub: user.id, userType: user.userType };
    const accessToken = this.jwtService.sign(payload);

    // Notify all admin users about the login
    const admins = await this.usersService.findAllAdmins();
    for (const admin of admins) {
      // Don't send notification if the user logging in is an admin
      if (admin.id !== user.id) {
        await this.emailService.sendAdminNotificationUserLogin(
          admin.email,
          user.username,
          user.email,
        );
      }
    }

    return {
      accessToken,
      user: {
        id: user.id,
        username: user.username,
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

    // Notify all admin users about the email verification
    const admins = await this.usersService.findAllAdmins();
    for (const admin of admins) {
      await this.emailService.sendAdminNotificationEmailVerified(
        admin.email,
        user.username,
        user.email,
      );
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

  async checkUsernameAvailability(username: string) {
    if (!username || username.trim().length === 0) {
      throw new BadRequestException('Username is required');
    }

    const existingUser = await this.usersService.findByUsername(username);
    return {
      available: !existingUser,
      username,
    };
  }
}
