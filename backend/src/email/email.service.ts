import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter;

  constructor(private configService: ConfigService) {
    const emailHost = this.configService.get('EMAIL_HOST');
    const emailPort = parseInt(this.configService.get('EMAIL_PORT') || '587');
    
    // Use secure connection for port 465, otherwise use STARTTLS
    const isSecure = emailPort === 465;
    
    this.transporter = nodemailer.createTransport({
      host: emailHost,
      port: emailPort,
      secure: isSecure,
      auth: {
        user: this.configService.get('EMAIL_USER'),
        pass: this.configService.get('EMAIL_PASSWORD'),
      },
      connectionTimeout: 10000, // 10 seconds
      greetingTimeout: 10000,
      socketTimeout: 10000,
      tls: {
        rejectUnauthorized: false, // Allow self-signed certificates
      },
    });
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const frontendUrl = this.configService.get('FRONTEND_URL');
    const verificationLink = `${frontendUrl}/verify-email?token=${token}`;

    const mailOptions = {
      from: this.configService.get('EMAIL_FROM'),
      to: email,
      subject: 'Email Verification - Birds Application',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Welcome to Birds Application!</h2>
          <p>Thank you for registering. Please verify your email address by clicking the link below:</p>
          <p>
            <a href="${verificationLink}" style="background-color: #4CAF50; color: white; padding: 14px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
              Verify Email Address
            </a>
          </p>
          <p>Or copy and paste this link into your browser:</p>
          <p>${verificationLink}</p>
          <p>This link will expire in 24 hours.</p>
          <p>If you didn't create an account, please ignore this email.</p>
        </div>
      `,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending email:', error);
      console.error('Email details:', {
        host: this.configService.get('EMAIL_HOST'),
        port: this.configService.get('EMAIL_PORT'),
        user: this.configService.get('EMAIL_USER'),
      });
      // Don't throw error in development - just log it
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Failed to send verification email');
      } else {
        console.warn('Email sending failed in development mode - continuing anyway');
      }
    }
  }

  async sendAdminNotificationEmailVerified(adminEmail: string, userUsername: string, userEmail: string): Promise<void> {
    const mailOptions = {
      from: this.configService.get('EMAIL_FROM'),
      to: adminEmail,
      subject: 'User Email Verified - Birds Application',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>User Email Verified</h2>
          <p>A user has verified their email address:</p>
          <ul>
            <li><strong>Username:</strong> ${userUsername}</li>
            <li><strong>Email:</strong> ${userEmail}</li>
          </ul>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending admin notification email:', error);
      // Don't throw - just log the error
    }
  }

  async sendAdminNotificationUserLogin(adminEmail: string, userUsername: string, userEmail: string): Promise<void> {
    const mailOptions = {
      from: this.configService.get('EMAIL_FROM'),
      to: adminEmail,
      subject: 'User Login - Birds Application',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>User Logged In</h2>
          <p>A user has logged into the system:</p>
          <ul>
            <li><strong>Username:</strong> ${userUsername}</li>
            <li><strong>Email:</strong> ${userEmail}</li>
            <li><strong>Login Time:</strong> ${new Date().toLocaleString()}</li>
          </ul>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending admin notification email:', error);
      // Don't throw - just log the error
    }
  }
}
