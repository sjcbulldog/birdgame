import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async create(username: string, email: string, password: string, firstName?: string, lastName?: string): Promise<User> {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Check if this is the first user
    const userCount = await this.usersRepository.count();
    const userType = userCount === 0 ? 'admin' : 'normal';
    
    const user = this.usersRepository.create({
      username,
      email,
      password: hashedPassword,
      firstName,
      lastName,
      userType,
    });
    return this.usersRepository.save(user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { username } });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async setEmailVerificationToken(userId: string, token: string, expires: Date): Promise<void> {
    await this.usersRepository.update(userId, {
      emailVerificationToken: token,
      emailVerificationExpires: expires,
    });
  }

  async verifyEmail(token: string): Promise<User | null> {
    const user = await this.usersRepository.findOne({
      where: { emailVerificationToken: token },
    });

    if (!user || !user.emailVerificationExpires) {
      return null;
    }

    if (user.emailVerificationExpires < new Date()) {
      return null;
    }

    user.status = 'verified';
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;

    return this.usersRepository.save(user);
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password);
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find({
      select: ['id', 'username', 'email', 'firstName', 'lastName', 'status', 'userType', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
  }

  async updateUserType(userId: string, userType: string): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    user.userType = userType;
    return this.usersRepository.save(user);
  }

  async findAllAdmins(): Promise<User[]> {
    return this.usersRepository.find({
      where: { userType: 'admin' },
      select: ['id', 'username', 'email', 'firstName', 'lastName'],
    });
  }
}
