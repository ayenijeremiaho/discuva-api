import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class CharacterIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[a-z0-9_]{1,40}$/.test(value))
      throw new BadRequestException('Invalid character id');
    return value;
  }
}
