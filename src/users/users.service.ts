import { Injectable } from '@nestjs/common';
import { User } from './users.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(dto.password, saltRounds);

    const user = this.userRepository.create({
      email: dto.email,
      password: hashedPassword,
    });

    return this.userRepository.save(user);
  }

  async getUserByEmail(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });

    return user;
  }

  async getUserById(id: string) {
    return this.userRepository.findOne({ where: { id } });
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.userRepository.update({ id }, { isEmailVerified: true });
  }
}
